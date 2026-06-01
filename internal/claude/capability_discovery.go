package claude

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type DiscoveryStage string

const (
	DiscoveryStageUser    DiscoveryStage = "user"
	DiscoveryStageProject DiscoveryStage = "project"
)

const (
	discoveryTimeout      = 12 * time.Second
	discoverySettleWindow = 100 * time.Millisecond
	slowDiscoveryLogAfter = 2 * time.Second
)

type DiscoveryTransport interface {
	Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error)
}

type CapabilityDiscovery interface {
	Discover(projectPath string) (CapabilityLayers, error)
	Refresh(projectPath string) (CapabilityLayers, error)
	Cached(projectPath string) (CapabilityLayers, bool)
	PrewarmUser() bool
}

type CapabilityDiscoveryService struct {
	transport           DiscoveryTransport
	claudeVersion       func() (string, error)
	userCacheGeneration func() (string, error)
	mu                  sync.Mutex
	projectCache        map[string]projectCacheEntry
	cachedVersion       string
	cachedVersionErr    error
}

type projectCacheEntry struct {
	key    string
	layers CapabilityLayers
}

type ClaudeCapabilityDiscoveryTransport struct {
	binaryPath    string
	realHomeDir   string
	discoveryArgs []string
	timeout       time.Duration
	makeTempDir   func(dir, pattern string) (string, error)
}

func NewCapabilityDiscoveryService(transport DiscoveryTransport) *CapabilityDiscoveryService {
	service := &CapabilityDiscoveryService{
		transport:    transport,
		projectCache: make(map[string]projectCacheEntry),
	}
	service.claudeVersion = service.defaultClaudeVersion
	service.userCacheGeneration = service.defaultUserCacheGeneration
	return service
}

func NewClaudeCapabilityDiscoveryTransport() (*ClaudeCapabilityDiscoveryTransport, error) {
	binaryPath, err := discoverClaudeBinaryPath()
	if err != nil {
		return nil, err
	}

	realHomeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	return &ClaudeCapabilityDiscoveryTransport{
		binaryPath:  binaryPath,
		realHomeDir: realHomeDir,
		discoveryArgs: []string{
			"--print",
			"--input-format", "stream-json",
			"--output-format", "stream-json",
			"--verbose",
			"--dangerously-skip-permissions",
		},
		timeout:     discoveryTimeout,
		makeTempDir: os.MkdirTemp,
	}, nil
}

func (s *CapabilityDiscoveryService) Discover(projectPath string) (CapabilityLayers, error) {
	return s.discover(projectPath, false)
}

func (s *CapabilityDiscoveryService) Refresh(projectPath string) (CapabilityLayers, error) {
	return s.discover(projectPath, true)
}

func (s *CapabilityDiscoveryService) Cached(projectPath string) (CapabilityLayers, bool) {
	projectKey, err := s.currentProjectKey(projectPath)
	if err != nil || projectKey == "" {
		return CapabilityLayers{}, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	cached, ok := s.projectCache[projectKey]
	if !ok {
		return CapabilityLayers{}, false
	}
	return cached.layers, true
}

func (s *CapabilityDiscoveryService) PrewarmUser() bool {
	_, err := s.discover("", false)
	return err == nil
}

func (s *CapabilityDiscoveryService) currentVersion() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cachedVersion != "" || s.cachedVersionErr != nil {
		if s.cachedVersionErr != nil {
			return "", s.cachedVersionErr
		}
		return s.cachedVersion, nil
	}

	version, err := s.claudeVersion()
	s.cachedVersion = version
	s.cachedVersionErr = err
	if err != nil {
		return "", err
	}
	return version, nil
}

func (s *CapabilityDiscoveryService) currentProjectKey(projectPath string) (string, error) {
	version, err := s.currentVersion()
	if err != nil {
		return "", err
	}

	userGeneration, err := s.userCacheGeneration()
	if err != nil {
		return "", err
	}

	return cacheKey(version, strings.TrimSpace(projectPath), userGeneration), nil
}

func (s *CapabilityDiscoveryService) discover(projectPath string, force bool) (CapabilityLayers, error) {
	start := time.Now()
	projectKey, err := s.currentProjectKey(projectPath)
	if err != nil {
		return CapabilityLayers{}, err
	}

	if !force {
		s.mu.Lock()
		if cached, ok := s.projectCache[projectKey]; ok {
			layers := cached.layers
			s.mu.Unlock()
			return layers, nil
		}
		s.mu.Unlock()
	}

	snapshot, err := s.loadCurrentSnapshot(projectPath)
	if err != nil {
		log.Printf("[capability-discovery] project=%q force=%v failed after %s: %v", projectPath, force, time.Since(start), err)
		return CapabilityLayers{}, err
	}

	layers := BuildCapabilityLayersFromSnapshot(snapshot)
	if time.Since(start) >= slowDiscoveryLogAfter {
		log.Printf("[capability-discovery] project=%q force=%v completed in %s commands=%d skills=%d agents=%d", projectPath, force, time.Since(start), len(snapshot.Commands), len(snapshot.Skills), len(snapshot.Agents))
	}

	s.mu.Lock()
	s.projectCache[projectKey] = projectCacheEntry{key: projectKey, layers: layers}
	s.mu.Unlock()

	return layers, nil
}

func (s *CapabilityDiscoveryService) loadCurrentSnapshot(projectPath string) (CapabilitySnapshot, error) {
	if strings.TrimSpace(projectPath) == "" {
		return s.transport.Run(DiscoveryStageUser, "")
	}
	return s.transport.Run(DiscoveryStageProject, projectPath)
}

func (s *CapabilityDiscoveryService) defaultClaudeVersion() (string, error) {
	transport, ok := s.transport.(*ClaudeCapabilityDiscoveryTransport)
	if !ok || transport == nil || strings.TrimSpace(transport.binaryPath) == "" {
		return "unknown", nil
	}

	output, err := exec.Command(transport.binaryPath, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("discover claude version: %w", err)
	}

	version := strings.TrimSpace(string(output))
	if version == "" {
		return "unknown", nil
	}
	return version, nil
}

func (s *CapabilityDiscoveryService) defaultUserCacheGeneration() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for discovery cache: %w", err)
	}

	paths := []string{
		filepath.Join(homeDir, ".claude"),
		filepath.Join(homeDir, ".claude.json"),
		filepath.Join(homeDir, ".claude.json.bak"),
	}

	latest := time.Time{}
	seen := false
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", fmt.Errorf("stat discovery cache source %q: %w", path, err)
		}
		if !seen || info.ModTime().After(latest) {
			latest = info.ModTime()
			seen = true
		}
	}

	if !seen {
		return "none", nil
	}
	return latest.UTC().Format(time.RFC3339Nano), nil
}

func cacheKey(parts ...string) string {
	return strings.Join(parts, "\x00")
}

func (t *ClaudeCapabilityDiscoveryTransport) Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error) {
	if t == nil {
		return CapabilitySnapshot{}, errors.New("discovery transport is nil")
	}

	timeout := t.timeout
	if timeout <= 0 {
		timeout = discoveryTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd, cleanup, err := t.buildCommand(ctx, stage, projectPath)
	if err != nil {
		return CapabilitySnapshot{}, err
	}
	defer cleanup()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return CapabilitySnapshot{}, fmt.Errorf("create discovery stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return CapabilitySnapshot{}, fmt.Errorf("create discovery stderr pipe: %w", err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return CapabilitySnapshot{}, fmt.Errorf("create discovery stdin pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return CapabilitySnapshot{}, fmt.Errorf("start discovery command: %w", err)
	}

	linesCh := make(chan []byte, 256)
	readErrCh := make(chan error, 2)
	var readers sync.WaitGroup
	readers.Add(2)
	go t.readLineStream(stdout, &readers, linesCh, readErrCh)
	go t.readLineStream(stderr, &readers, linesCh, readErrCh)
	go func() {
		readers.Wait()
		close(linesCh)
		close(readErrCh)
	}()

	if _, err := io.WriteString(stdin, "{\"type\":\"control_request\",\"request_id\":\"init_1\",\"request\":{\"subtype\":\"initialize\"}}\n"); err != nil {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return CapabilitySnapshot{}, fmt.Errorf("write discovery initialize request: %w", err)
	}

	var lines [][]byte
	var stderrLines []string
	settleTimer := time.NewTimer(timeout)
	if !settleTimer.Stop() {
		<-settleTimer.C
	}
	settleActive := false
	finalize := func() (CapabilitySnapshot, error) {
		commands, skills, agents, err := CollectDiscoveryData(lines)
		if err != nil {
			return CapabilitySnapshot{}, err
		}
		if len(commands) == 0 && len(skills) == 0 && len(agents) == 0 && len(stderrLines) > 0 {
			return CapabilitySnapshot{}, fmt.Errorf("discovery %s stage produced no capabilities: %s", stage, strings.Join(stderrLines, " | "))
		}
		if len(commands) == 0 && len(skills) == 0 && len(agents) == 0 {
			return CapabilitySnapshot{}, fmt.Errorf("discovery %s stage initialized but produced no capabilities", stage)
		}
		return CapabilitySnapshot{Stage: string(stage), Commands: commands, Skills: skills, Agents: agents}, nil
	}
	stopProcess := func() {
		_ = stdin.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}
	defer func() {
		if settleActive && !settleTimer.Stop() {
			select {
			case <-settleTimer.C:
			default:
			}
		}
	}()

	for {
		var settleCh <-chan time.Time
		if settleActive {
			settleCh = settleTimer.C
		}

		select {
		case <-ctx.Done():
			stopProcess()
			return CapabilitySnapshot{}, fmt.Errorf("discovery %s stage timed out after %s", stage, timeout)
		case <-settleCh:
			stopProcess()
			return finalize()
		case err, ok := <-readErrCh:
			if !ok {
				readErrCh = nil
				continue
			}
			if err != nil {
				stopProcess()
				return CapabilitySnapshot{}, fmt.Errorf("read discovery output: %w", err)
			}
		case line, ok := <-linesCh:
			if !ok {
				stopProcess()
				return finalize()
			}
			trimmed := strings.TrimSpace(string(line))
			if trimmed == "" {
				continue
			}
			lines = append(lines, append([]byte(nil), line...))
			if !strings.HasPrefix(trimmed, "{") {
				stderrLines = append(stderrLines, trimmed)
				continue
			}

			messageHadCapability := false
			if commands, ok, err := ParseCommandSummariesFromLine(line); err != nil {
				stopProcess()
				return CapabilitySnapshot{}, fmt.Errorf("parse discovery commands: %w", err)
			} else if ok && len(commands) > 0 {
				messageHadCapability = true
			}
			if skills, ok, err := ParseSkillsFromLine(line); err != nil {
				stopProcess()
				return CapabilitySnapshot{}, fmt.Errorf("parse discovery skills: %w", err)
			} else if ok && len(skills) > 0 {
				messageHadCapability = true
			}
			if agents, ok, err := ParseAgentsFromLine(line); err != nil {
				stopProcess()
				return CapabilitySnapshot{}, fmt.Errorf("parse discovery agents: %w", err)
			} else if ok && len(agents) > 0 {
				messageHadCapability = true
			}
			if messageHadCapability {
				if !settleActive {
					settleActive = true
				}
				settleTimer.Reset(discoverySettleWindow)
			}
		}
	}
}

func (t *ClaudeCapabilityDiscoveryTransport) buildCommand(ctx context.Context, stage DiscoveryStage, projectPath string) (*exec.Cmd, func(), error) {
	if t.binaryPath == "" {
		return nil, nil, errors.New("claude discovery binary path is empty")
	}
	if t.realHomeDir == "" {
		return nil, nil, errors.New("claude discovery real home is empty")
	}
	if t.makeTempDir == nil {
		t.makeTempDir = os.MkdirTemp
	}
	if len(t.discoveryArgs) == 0 {
		t.discoveryArgs = []string{"--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"}
	}

	workingDir := projectPath
	homeDir := t.realHomeDir
	cleanup := func() {}
	env := ensureFullShellPath(os.Environ())

	switch stage {
	case DiscoveryStageUser:
		emptyCwd, err := t.makeTempDir("", "claude-discovery-cwd-*")
		if err != nil {
			return nil, nil, fmt.Errorf("create isolated user cwd: %w", err)
		}
		workingDir = emptyCwd
		cleanup = func() {
			_ = os.RemoveAll(emptyCwd)
		}
	case DiscoveryStageProject:
		if strings.TrimSpace(projectPath) == "" {
			return nil, nil, errors.New("project discovery stage requires a project path")
		}
	default:
		return nil, nil, fmt.Errorf("unsupported discovery stage %q", stage)
	}

	cmd := exec.CommandContext(ctx, t.binaryPath, t.discoveryArgs...)
	cmd.Dir = workingDir
	cmd.Env = setEnv(env, "HOME", homeDir)
	cmd.Env = setEnv(cmd.Env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "true")

	return cmd, cleanup, nil
}

func (t *ClaudeCapabilityDiscoveryTransport) readLineStream(reader io.Reader, wg *sync.WaitGroup, lines chan<- []byte, errs chan<- error) {
	defer wg.Done()

	scanner := bufio.NewScanner(reader)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		lines <- line
	}
	if err := scanner.Err(); err != nil {
		errs <- err
	}
}

func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
