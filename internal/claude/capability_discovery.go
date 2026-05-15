package claude

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type DiscoveryStage string

const (
	DiscoveryStageSystem  DiscoveryStage = "system"
	DiscoveryStageUser    DiscoveryStage = "user"
	DiscoveryStageProject DiscoveryStage = "project"
)

const (
	discoveryTimeout      = 12 * time.Second
	discoverySettleWindow = 100 * time.Millisecond
)

type DiscoveryTransport interface {
	Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error)
}

type CapabilityDiscovery interface {
	Discover(projectPath string) (CapabilityLayers, error)
	Refresh(projectPath string) (CapabilityLayers, error)
	Cached(projectPath string) (CapabilityLayers, bool)
	PrewarmSystem() bool
	PrewarmUser() bool
	PrewarmProject(projectPath string) bool
}

type CapabilityDiscoveryService struct {
	transport           DiscoveryTransport
	claudeVersion       func() (string, error)
	userCacheGeneration func() (string, error)
	mu                  sync.Mutex
	systemCache         systemCache
	userCache           userCache
	projectCache        map[string]projectCacheEntry
	cachedVersion       string
	cachedVersionErr    error
	cachedUserGen       string
	cachedUserGenErr    error
}

type systemCache struct {
	key      string
	snapshot CapabilitySnapshot
	valid    bool
}

type userCache struct {
	key      string
	snapshot CapabilitySnapshot
	valid    bool
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
	systemKey := s.currentSystemKey()
	userKey := s.currentUserKey()
	projectKey := s.currentProjectKey(projectPath)
	if systemKey == "" || userKey == "" {
		return CapabilityLayers{}, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.systemCache.valid || s.systemCache.key != systemKey {
		return CapabilityLayers{}, false
	}
	if !s.userCache.valid || s.userCache.key != userKey {
		return CapabilityLayers{}, false
	}

	projectSnapshot := CapabilitySnapshot{Stage: string(DiscoveryStageProject)}
	if strings.TrimSpace(projectPath) != "" {
		cached, ok := s.projectCache[projectKey]
		if !ok {
			return BuildCapabilityLayers(s.systemCache.snapshot, s.userCache.snapshot, projectSnapshot), true
		}
		return cached.layers, true
	}

	return BuildCapabilityLayers(s.systemCache.snapshot, s.userCache.snapshot, projectSnapshot), true
}

func (s *CapabilityDiscoveryService) PrewarmSystem() bool {
	_, err := s.loadSystemSnapshot("", s.currentSystemKey(), false)
	return err == nil
}

func (s *CapabilityDiscoveryService) PrewarmUser() bool {
	_, err := s.loadUserSnapshot("", s.currentUserKey(), false)
	return err == nil
}

func (s *CapabilityDiscoveryService) PrewarmProject(projectPath string) bool {
	if strings.TrimSpace(projectPath) == "" {
		return false
	}
	_, err := s.discover(projectPath, false)
	return err == nil
}

func (s *CapabilityDiscoveryService) currentSystemKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cachedVersion != "" || s.cachedVersionErr != nil {
		if s.cachedVersionErr != nil {
			return ""
		}
		return s.cachedVersion
	}

	version, err := s.claudeVersion()
	s.cachedVersion = version
	s.cachedVersionErr = err
	if err != nil {
		return ""
	}
	return version
}

func (s *CapabilityDiscoveryService) currentUserKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	version := s.cachedVersion
	versionErr := s.cachedVersionErr
	if version == "" && versionErr == nil {
		version, versionErr = s.claudeVersion()
		s.cachedVersion = version
		s.cachedVersionErr = versionErr
	}
	if versionErr != nil {
		return ""
	}

	userGeneration := s.cachedUserGen
	userGenerationErr := s.cachedUserGenErr
	if userGeneration == "" && userGenerationErr == nil {
		userGeneration, userGenerationErr = s.userCacheGeneration()
		s.cachedUserGen = userGeneration
		s.cachedUserGenErr = userGenerationErr
	}
	if userGenerationErr != nil {
		return ""
	}

	return cacheKey(version, userGeneration)
}

func (s *CapabilityDiscoveryService) currentProjectKey(projectPath string) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	version := s.cachedVersion
	versionErr := s.cachedVersionErr
	if version == "" && versionErr == nil {
		version, versionErr = s.claudeVersion()
		s.cachedVersion = version
		s.cachedVersionErr = versionErr
	}
	if versionErr != nil {
		return ""
	}

	userGeneration := s.cachedUserGen
	userGenerationErr := s.cachedUserGenErr
	if userGeneration == "" && userGenerationErr == nil {
		userGeneration, userGenerationErr = s.userCacheGeneration()
		s.cachedUserGen = userGeneration
		s.cachedUserGenErr = userGenerationErr
	}
	if userGenerationErr != nil {
		return ""
	}

	return cacheKey(version, projectPath, userGeneration)
}

func (s *CapabilityDiscoveryService) discover(projectPath string, force bool) (CapabilityLayers, error) {
	version, err := s.claudeVersion()
	if err != nil {
		return CapabilityLayers{}, err
	}
	userGeneration, err := s.userCacheGeneration()
	if err != nil {
		return CapabilityLayers{}, err
	}

	systemKey := version
	userKey := cacheKey(version, userGeneration)
	projectKey := cacheKey(version, projectPath, userGeneration)

	if !force {
		s.mu.Lock()
		if cached, ok := s.projectCache[projectKey]; ok {
			layers := cached.layers
			s.mu.Unlock()
			return layers, nil
		}
		s.mu.Unlock()
	}

	systemSnapshot, err := s.loadSystemSnapshot(projectPath, systemKey, force)
	if err != nil {
		return CapabilityLayers{}, err
	}

	userSnapshot, err := s.loadUserSnapshot(projectPath, userKey, force)
	if err != nil {
		return CapabilityLayers{}, err
	}

	projectSnapshot, err := s.transport.Run(DiscoveryStageProject, projectPath)
	if err != nil {
		return CapabilityLayers{}, err
	}

	layers := BuildCapabilityLayers(systemSnapshot, userSnapshot, projectSnapshot)

	s.mu.Lock()
	s.projectCache[projectKey] = projectCacheEntry{key: projectKey, layers: layers}
	s.mu.Unlock()

	return layers, nil
}

func (s *CapabilityDiscoveryService) loadSystemSnapshot(projectPath, key string, force bool) (CapabilitySnapshot, error) {
	if !force {
		s.mu.Lock()
		if s.systemCache.valid && s.systemCache.key == key {
			snapshot := s.systemCache.snapshot
			s.mu.Unlock()
			return snapshot, nil
		}
		s.mu.Unlock()
	}

	snapshot, err := s.transport.Run(DiscoveryStageSystem, projectPath)
	if err != nil {
		return CapabilitySnapshot{}, err
	}

	s.mu.Lock()
	s.systemCache = systemCache{key: key, snapshot: snapshot, valid: true}
	s.mu.Unlock()

	return snapshot, nil
}

func (s *CapabilityDiscoveryService) loadUserSnapshot(projectPath, key string, force bool) (CapabilitySnapshot, error) {
	if !force {
		s.mu.Lock()
		if s.userCache.valid && s.userCache.key == key {
			snapshot := s.userCache.snapshot
			s.mu.Unlock()
			return snapshot, nil
		}
		s.mu.Unlock()
	}

	snapshot, err := s.transport.Run(DiscoveryStageUser, projectPath)
	if err != nil {
		return CapabilitySnapshot{}, err
	}

	s.mu.Lock()
	s.userCache = userCache{key: key, snapshot: snapshot, valid: true}
	s.mu.Unlock()

	return snapshot, nil
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
		commands, skills, err := CollectDiscoveryData(lines)
		if err != nil {
			return CapabilitySnapshot{}, err
		}
		if len(commands) == 0 && len(skills) == 0 && len(stderrLines) > 0 {
			return CapabilitySnapshot{}, fmt.Errorf("discovery %s stage produced no capabilities: %s", stage, strings.Join(stderrLines, " | "))
		}
		if len(commands) == 0 && len(skills) == 0 {
			return CapabilitySnapshot{}, fmt.Errorf("discovery %s stage initialized but produced no capabilities", stage)
		}
		return CapabilitySnapshot{Stage: string(stage), Commands: commands, Skills: skills}, nil
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
	env := discoveryBaseEnv()

	switch stage {
	case DiscoveryStageSystem:
		isolatedHome, err := t.makeTempDir("", "claude-discovery-home-*")
		if err != nil {
			return nil, nil, fmt.Errorf("create isolated system home: %w", err)
		}
		emptyCwd, err := t.makeTempDir("", "claude-discovery-cwd-*")
		if err != nil {
			_ = os.RemoveAll(isolatedHome)
			return nil, nil, fmt.Errorf("create isolated system cwd: %w", err)
		}
		homeDir = isolatedHome
		workingDir = emptyCwd
		cleanup = func() {
			_ = os.RemoveAll(isolatedHome)
			_ = os.RemoveAll(emptyCwd)
		}
	case DiscoveryStageUser:
		emptyCwd, err := t.makeTempDir("", "claude-discovery-cwd-*")
		if err != nil {
			return nil, nil, fmt.Errorf("create isolated user cwd: %w", err)
		}
		workingDir = emptyCwd
		cleanup = func() {
			_ = os.RemoveAll(emptyCwd)
		}
		env = ensureFullShellPath(os.Environ())
	case DiscoveryStageProject:
		if strings.TrimSpace(projectPath) == "" {
			return nil, nil, errors.New("project discovery stage requires a project path")
		}
		env = ensureFullShellPath(os.Environ())
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

func discoveryBaseEnv() []string {
	env := make([]string, 0, 3)
	for _, key := range []string{"PATH", "TMPDIR", "TMP"} {
		if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
			env = append(env, key+"="+value)
		}
	}
	return ensureFullShellPath(env)
}
