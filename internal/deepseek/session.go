package deepseek

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"ropcode/internal/sessionproc"
)

type SessionConfig struct {
	ProjectPath   string `json:"project_path"`
	Prompt        string `json:"prompt"`
	Model         string `json:"model"`
	ProviderApiID string `json:"provider_api_id,omitempty"`
	SessionID     string `json:"session_id,omitempty"`
	Resume        bool   `json:"resume,omitempty"`
	AuthToken     string `json:"auth_token,omitempty"`
	BaseURL       string `json:"base_url,omitempty"`
}

type SessionStatus struct {
	SessionID   string    `json:"session_id"`
	ProjectPath string    `json:"project_path"`
	Model       string    `json:"model"`
	Status      string    `json:"status"`
	StartedAt   time.Time `json:"started_at"`
	PID         int       `json:"pid,omitempty"`
}

type Session struct {
	ID        string
	RuntimeID string
	Config    SessionConfig
	Status    string
	StartedAt time.Time

	cmd    *exec.Cmd
	stdout io.ReadCloser
	stderr io.ReadCloser

	outputBuf      []byte
	stderrBuf      []byte
	mu             sync.RWMutex
	done           chan struct{}
	cancelled      bool
	processEmitter ProcessChangedEmitter
}

type EventEmitter interface {
	Emit(eventName string, data interface{})
}

type ProcessChangedEmitter interface {
	EmitProcessChanged(event ProcessChangedEvent)
}

type ProcessChangedEvent struct {
	PID      int    `json:"pid"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"`
	ExitCode *int   `json:"exitCode,omitempty"`
}

func NewSession(config SessionConfig) *Session {
	sessionID := config.SessionID
	if sessionID == "" {
		sessionID = uuid.New().String()
	}
	return &Session{
		ID:        sessionID,
		RuntimeID: sessionID,
		Config:    config,
		Status:    "created",
		StartedAt: time.Now(),
		outputBuf: make([]byte, 0),
		done:      make(chan struct{}),
	}
}

func (s *Session) Start(ctx context.Context, binaryPath string, emitter EventEmitter, processEmitter ProcessChangedEmitter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == "running" {
		return fmt.Errorf("session already running")
	}
	s.processEmitter = processEmitter

	args := s.Config.buildArgs()
	log.Printf("[DeepSeek Session] Starting DeepSeek with args: %v", args)

	s.cmd = exec.CommandContext(ctx, binaryPath, args...)
	if err := sessionproc.Configure(s.cmd); err != nil {
		return fmt.Errorf("failed to configure command: %w", err)
	}
	if s.Config.ProjectPath != "" {
		s.cmd.Dir = s.Config.ProjectPath
	}
	s.cmd.Env = s.Config.applyProviderApiEnv(enhanceEnvForProduction())

	var err error
	s.stdout, err = s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	s.stderr, err = s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}
	if err := sessionproc.Start(s.cmd); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	s.Status = "running"
	s.StartedAt = time.Now()
	if s.processEmitter != nil {
		s.processEmitter.EmitProcessChanged(ProcessChangedEvent{
			PID:   s.cmd.Process.Pid,
			Cwd:   s.Config.ProjectPath,
			State: "running",
		})
	}

	if emitter != nil && s.Config.Prompt != "" {
		userMessage := map[string]interface{}{
			"type":       "user",
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
			"provider":   "deepseek",
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": s.Config.Prompt},
				},
			},
		}
		userJSON, _ := json.Marshal(userMessage)
		emitter.Emit("claude-output", string(userJSON))
	}

	go s.readOutput(s.stdout, "stdout", emitter)
	go s.readOutput(s.stderr, "stderr", emitter)
	go s.waitForCompletion(emitter)
	return nil
}

func (c SessionConfig) buildArgs() []string {
	args := []string{"exec", "--auto", "--output-format", "stream-json"}
	if c.Model != "" {
		args = append(args, "--model", c.Model)
	}
	if c.Resume && c.SessionID != "" {
		args = append(args, "--resume", c.SessionID)
	}
	args = append(args, "--", c.Prompt)
	return args
}

func (s *Session) readOutput(reader io.ReadCloser, outputType string, emitter EventEmitter) {
	scanner := bufio.NewScanner(reader)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		s.mu.Lock()
		s.outputBuf = append(s.outputBuf, []byte(line+"\n")...)
		if outputType == "stderr" && line != "" {
			log.Printf("[DeepSeek Session] stderr: %s", line)
			s.stderrBuf = append(s.stderrBuf, []byte(line+"\n")...)
		}
		s.mu.Unlock()

		if emitter != nil && outputType == "stdout" {
			unified := s.transformToUnified(line)
			if unified != "" {
				emitter.Emit("claude-output", unified)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		s.mu.Lock()
		s.stderrBuf = append(s.stderrBuf, []byte(fmt.Sprintf("Scanner error: %s\n", err.Error()))...)
		s.mu.Unlock()
	}
}

func (s *Session) transformToUnified(line string) string {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(line), &parsed); err != nil {
		return marshalUnified(map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "deepseek",
			"type":     "info",
			"message": map[string]interface{}{
				"content": []map[string]interface{}{{"type": "text", "text": line}},
			},
		})
	}

	eventType, _ := parsed["type"].(string)
	switch eventType {
	case "content":
		content, _ := parsed["content"].(string)
		if content == "" {
			return ""
		}
		return marshalUnified(map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "deepseek",
			"type":     "assistant",
			"is_delta": true,
			"message": map[string]interface{}{
				"role":    "assistant",
				"content": []map[string]interface{}{{"type": "text", "text": content}},
			},
		})
	case "tool_use":
		id, _ := parsed["id"].(string)
		name, _ := parsed["name"].(string)
		input, _ := parsed["input"].(map[string]interface{})
		toolName, toolInput := adaptDeepSeekToolToClaude(name, input)
		return marshalUnified(map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "deepseek",
			"type":     "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{{
					"type":  "tool_use",
					"id":    id,
					"name":  toolName,
					"input": toolInput,
				}},
			},
		})
	case "tool_result":
		id, _ := parsed["id"].(string)
		output, _ := parsed["output"].(string)
		status, _ := parsed["status"].(string)
		return marshalUnified(map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "deepseek",
			"type":     "user",
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{{
					"type":        "tool_result",
					"tool_use_id": id,
					"content":     output,
					"is_error":    status == "error",
				}},
			},
		})
	case "session_capture":
		sessionID, _ := parsed["content"].(string)
		if sessionID != "" {
			s.mu.Lock()
			s.ID = sessionID
			runtimeID := s.RuntimeID
			s.mu.Unlock()
			return marshalUnified(map[string]interface{}{
				"cwd":                s.Config.ProjectPath,
				"provider":           "deepseek",
				"type":               "system",
				"subtype":            "init",
				"session_id":         sessionID,
				"runtime_session_id": runtimeID,
			})
		}
		return marshalUnified(map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"provider":   "deepseek",
			"type":       "system",
			"subtype":    "init",
			"session_id": sessionID,
		})
	case "metadata":
		meta, _ := parsed["meta"].(map[string]interface{})
		sessionID, _ := meta["session_id"].(string)
		if sessionID != "" {
			s.mu.Lock()
			s.ID = sessionID
			runtimeID := s.RuntimeID
			s.mu.Unlock()
			return marshalUnified(map[string]interface{}{
				"cwd":                s.Config.ProjectPath,
				"provider":           "deepseek",
				"type":               "result",
				"subtype":            "metadata",
				"session_id":         sessionID,
				"runtime_session_id": runtimeID,
				"usage":              meta,
			})
		}
		return marshalUnified(map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"provider":   "deepseek",
			"type":       "result",
			"subtype":    "metadata",
			"session_id": sessionID,
			"usage":      meta,
		})
	case "done":
		s.mu.RLock()
		sessionID := s.ID
		runtimeID := s.RuntimeID
		s.mu.RUnlock()
		return marshalUnified(map[string]interface{}{
			"cwd":                s.Config.ProjectPath,
			"provider":           "deepseek",
			"type":               "result",
			"subtype":            "session_complete",
			"success":            true,
			"session_id":         sessionID,
			"runtime_session_id": runtimeID,
		})
	case "error":
		errorMsg, _ := parsed["error"].(string)
		return marshalUnified(map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "deepseek",
			"type":     "error",
			"error":    errorMsg,
		})
	default:
		parsed["cwd"] = s.Config.ProjectPath
		parsed["provider"] = "deepseek"
		return marshalUnified(parsed)
	}
}

func marshalUnified(value map[string]interface{}) string {
	result, _ := json.Marshal(value)
	return string(result)
}

func adaptDeepSeekToolToClaude(toolName string, input map[string]interface{}) (string, interface{}) {
	if input == nil {
		input = map[string]interface{}{}
	}
	switch toolName {
	case "exec_shell", "exec_shell_wait", "shell", "shell_command":
		command, _ := input["command"].(string)
		return "Bash", map[string]interface{}{"command": command}
	case "read_file":
		filePath, _ := input["path"].(string)
		if filePath == "" {
			filePath, _ = input["file_path"].(string)
		}
		return "Read", map[string]interface{}{"file_path": filePath}
	case "write_file":
		filePath, _ := input["path"].(string)
		if filePath == "" {
			filePath, _ = input["file_path"].(string)
		}
		content, _ := input["content"].(string)
		return "Write", map[string]interface{}{"file_path": filePath, "content": content}
	case "edit_file", "apply_patch":
		return "Edit", input
	case "list_dir", "list_files":
		return "LS", input
	case "search", "file_search", "grep":
		return "Grep", input
	case "checklist_write", "todo_write":
		return "TodoWrite", input
	default:
		return toolName, input
	}
}

func (s *Session) waitForCompletion(emitter EventEmitter) {
	if s.cmd == nil || s.cmd.Process == nil {
		return
	}
	err := s.cmd.Wait()
	sessionproc.Cleanup(s.cmd)

	s.mu.Lock()
	pid := s.cmd.Process.Pid
	projectPath := s.Config.ProjectPath
	processEmitter := s.processEmitter
	if s.cancelled {
		s.Status = "cancelled"
	} else if err != nil {
		s.Status = "failed"
	} else {
		s.Status = "completed"
	}
	stderrOutput := string(s.stderrBuf)
	status := s.Status
	sessionID := s.ID
	s.mu.Unlock()

	if processEmitter != nil {
		exitCode := 0
		if err != nil {
			exitCode = 1
		}
		processEmitter.EmitProcessChanged(ProcessChangedEvent{
			PID:      pid,
			Cwd:      projectPath,
			State:    "stopped",
			ExitCode: &exitCode,
		})
	}
	close(s.done)

	if err != nil && emitter != nil && !s.cancelled {
		errorMessage := fmt.Sprintf("DeepSeek process failed: %v", err)
		if strings.TrimSpace(stderrOutput) != "" {
			errorMessage = strings.TrimSpace(stderrOutput)
		}
		errMsg := map[string]interface{}{
			"type":       "error",
			"error":      errorMessage,
			"session_id": sessionID,
			"cwd":        projectPath,
			"provider":   "deepseek",
		}
		errJSON, _ := json.Marshal(errMsg)
		emitter.Emit("claude-error", string(errJSON))
	}
	if emitter != nil {
		completion := map[string]interface{}{
			"success": status == "completed",
			"cwd":     projectPath,
		}
		completionJSON, _ := json.Marshal(completion)
		emitter.Emit("claude-complete", string(completionJSON))
	}
}

func (s *Session) Terminate() error {
	s.mu.Lock()
	if s.cmd == nil || s.cmd.Process == nil {
		s.mu.Unlock()
		return fmt.Errorf("no process to terminate")
	}
	s.cancelled = true
	cmd := s.cmd
	done := s.done
	s.mu.Unlock()
	return sessionproc.Terminate(cmd, done)
}

func (s *Session) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Status == "running"
}

func (s *Session) GetOutput() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.outputBuf)
}

func (s *Session) GetPID() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.cmd != nil && s.cmd.Process != nil {
		return s.cmd.Process.Pid
	}
	return 0
}

func enhanceEnvForProduction() []string {
	env := os.Environ()
	additionalPaths := []string{
		"/opt/homebrew/bin",
		"/usr/local/bin",
		os.Getenv("HOME") + "/.local/bin",
		os.Getenv("HOME") + "/.cargo/bin",
		os.Getenv("HOME") + "/.npm-global/bin",
	}
	additionalPaths = append(additionalPaths, windowsNodePaths()...)
	return enhancePathEnv(env, additionalPaths)
}

func enhancePathEnv(env []string, additionalPaths []string) []string {
	existingPath := ""
	pathIndex := -1
	pathKey := "PATH"
	for i, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.EqualFold(key, "PATH") {
			existingPath = value
			pathIndex = i
			pathKey = key
			break
		}
	}
	separator := string(os.PathListSeparator)
	var newPath string
	for _, path := range additionalPaths {
		if _, err := os.Stat(path); err == nil {
			if newPath == "" {
				newPath = path
			} else {
				newPath += separator + path
			}
		}
	}
	if existingPath != "" {
		if newPath != "" {
			newPath += separator + existingPath
		} else {
			newPath = existingPath
		}
	}
	if pathIndex >= 0 {
		env[pathIndex] = pathKey + "=" + newPath
	} else {
		env = append(env, "PATH="+newPath)
	}
	return env
}

func windowsNodePaths() []string {
	paths := []string{}
	for _, key := range []string{"ROPCODE_TEST_NODE_DIR", "ROPCODE_TEST_NPM_DIR"} {
		if value := os.Getenv(key); value != "" {
			paths = append(paths, value)
		}
	}
	if programData := os.Getenv("ProgramData"); programData != "" {
		paths = append(paths, filepath.Join(programData, "npm", "npm"))
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		paths = append(paths, filepath.Join(appData, "npm"))
	}
	if programFiles := os.Getenv("ProgramFiles"); programFiles != "" {
		paths = append(paths, filepath.Join(programFiles, "nodejs"))
	}
	if programFilesX86 := os.Getenv("ProgramFiles(x86)"); programFilesX86 != "" {
		paths = append(paths, filepath.Join(programFilesX86, "nodejs"))
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		paths = append(paths, filepath.Join(localAppData, "Programs", "nodejs"))
	}
	paths = append(paths,
		`E:\nvm4w\nodejs`,
		`C:\nvm4w\nodejs`,
		`D:\nvm4w\nodejs`,
	)
	return paths
}

func (c SessionConfig) applyProviderApiEnv(env []string) []string {
	if c.AuthToken != "" {
		env = setEnvVar(env, "DEEPSEEK_API_KEY", c.AuthToken)
	}
	if c.BaseURL != "" {
		env = setEnvVar(env, "DEEPSEEK_BASE_URL", c.BaseURL)
	}
	return env
}

func setEnvVar(env []string, key, value string) []string {
	prefix := key + "="
	for i, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
