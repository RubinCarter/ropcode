// internal/gemini/session.go
package gemini

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/google/uuid"
)

type SessionConfig struct {
	ProjectPath   string `json:"project_path"`
	Prompt        string `json:"prompt"`
	Model         string `json:"model"`
	ProviderApiID string `json:"provider_api_id,omitempty"`
	SessionID     string `json:"session_id,omitempty"`
	Resume        bool   `json:"resume,omitempty"`
	// API configuration from ProviderApiConfig
	AuthToken string `json:"auth_token,omitempty"`
}

type SessionStatus struct {
	SessionID   string    `json:"session_id"`
	ProjectPath string    `json:"project_path"`
	Model       string    `json:"model"`
	Status      string    `json:"status"` // "running", "completed", "failed", "cancelled"
	StartedAt   time.Time `json:"started_at"`
	PID         int       `json:"pid,omitempty"`
}

type Session struct {
	ID        string
	Config    SessionConfig
	Status    string
	StartedAt time.Time

	cmd    *exec.Cmd
	stdout io.ReadCloser
	stderr io.ReadCloser

	outputBuf []byte
	mu        sync.RWMutex
	done      chan struct{}
	cancelled bool
}

// EventEmitter interface for emitting events
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

// NewSession creates a new session instance
func NewSession(config SessionConfig) *Session {
	sessionID := config.SessionID
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	return &Session{
		ID:        sessionID,
		Config:    config,
		Status:    "created",
		StartedAt: time.Now(),
		outputBuf: make([]byte, 0),
		done:      make(chan struct{}),
		cancelled: false,
	}
}

// Start starts the Gemini session
func (s *Session) Start(ctx context.Context, binaryPath string, emitter EventEmitter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == "running" {
		return fmt.Errorf("session already running")
	}

	// Build command arguments for Gemini CLI
	args := []string{}

	// Add model parameter
	if s.Config.Model != "" {
		args = append(args, "-m", s.Config.Model)
	}

	// Output format: stream-json for JSONL streaming
	args = append(args, "-o", "stream-json")

	// Approval mode: yolo (skip permission prompts)
	args = append(args, "--approval-mode", "yolo")

	// Add prompt as the last argument
	args = append(args, s.Config.Prompt)

	log.Printf("[Gemini Session] Starting Gemini with args: %v", args)

	// Create command
	s.cmd = exec.CommandContext(ctx, binaryPath, args...)

	// Set working directory to project path
	if s.Config.ProjectPath != "" {
		s.cmd.Dir = s.Config.ProjectPath
	}

	// Inherit environment variables from parent process and enhance PATH
	// This is critical for production (.app) builds where PATH is very limited
	// when launched via double-click (vs `open -a` from terminal)
	enhancedEnv := enhanceEnvForProduction()

	// If AuthToken is provided from database ProviderApiConfig, use it as GEMINI_API_KEY
	// This takes priority over environment variables loaded from settings.json or system
	if s.Config.AuthToken != "" {
		log.Printf("[Gemini Session] Using AuthToken from ProviderApiConfig")
		enhancedEnv = setEnvVar(enhancedEnv, "GEMINI_API_KEY", s.Config.AuthToken)
	}

	s.cmd.Env = enhancedEnv

	// Setup pipes
	var err error
	s.stdout, err = s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	s.stderr, err = s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	s.Status = "running"
	s.StartedAt = time.Now()

	// Start reading output in goroutines
	go s.readOutput(s.stdout, "stdout", emitter)
	go s.readOutput(s.stderr, "stderr", emitter)
	go s.waitForCompletion(emitter)

	return nil
}

// readOutput reads output from stdout or stderr
func (s *Session) readOutput(reader io.ReadCloser, outputType string, emitter EventEmitter) {
	scanner := bufio.NewScanner(reader)
	// Increase buffer size for large JSON outputs
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		s.mu.Lock()
		s.outputBuf = append(s.outputBuf, []byte(line+"\n")...)
		s.mu.Unlock()

		if emitter != nil {
			// Transform Gemini output to unified format
			unified := s.transformToUnified(line)
			if unified != "" {
				emitter.Emit("claude-output", unified)
			}
		}
	}

	// Handle scanner errors
	if err := scanner.Err(); err != nil && emitter != nil {
		errMsg := map[string]interface{}{
			"type":       "error",
			"error":      err.Error(),
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
			"provider":   "gemini",
		}
		errJSON, _ := json.Marshal(errMsg)
		emitter.Emit("claude-error", string(errJSON))
	}
}

// transformToUnified transforms Gemini JSONL output to unified Claude format
func (s *Session) transformToUnified(line string) string {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(line), &parsed); err != nil {
		// If not valid JSON, wrap as text message
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "gemini",
			"type":     "info",
			"message": map[string]interface{}{
				"content": []map[string]interface{}{
					{"type": "text", "text": line},
				},
			},
		}
		result, _ := json.Marshal(unified)
		return string(result)
	}

	eventType, _ := parsed["type"].(string)
	log.Printf("[Gemini Session] Transforming event type: %s", eventType)

	switch eventType {
	case "init":
		// Session initialization
		sessionID, _ := parsed["session_id"].(string)
		if sessionID != "" {
			s.ID = sessionID
		}
		unified := map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"provider":   "gemini",
			"type":       "system",
			"subtype":    "init",
			"session_id": sessionID,
		}
		result, _ := json.Marshal(unified)
		return string(result)

	case "message":
		// Message events
		role, _ := parsed["role"].(string)
		content, _ := parsed["content"].(string)
		isDelta, _ := parsed["delta"].(bool)

		if role == "user" {
			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "gemini",
				"type":     "user",
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{"type": "text", "text": content},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)
		} else if role == "assistant" {
			// Skip empty messages
			if content == "" {
				return ""
			}
			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "gemini",
				"type":     "assistant",
				"is_delta": isDelta,
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "text", "text": content},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)
		}

	case "tool_use":
		// Tool use events
		toolName, _ := parsed["tool_name"].(string)
		toolID, _ := parsed["tool_id"].(string)
		parameters := parsed["parameters"]
		if parameters == nil {
			parameters = map[string]interface{}{}
		}

		// Map Gemini tool name to Claude standard tool name
		claudeName, claudeInput := adaptGeminiToolToClaude(toolName, parameters)

		toolUseContent := map[string]interface{}{
			"type":  "tool_use",
			"id":    toolID,
			"name":  claudeName,
			"input": claudeInput,
		}
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "gemini",
			"type":     "assistant",
			"message": map[string]interface{}{
				"role":    "assistant",
				"content": []map[string]interface{}{toolUseContent},
			},
		}
		result, _ := json.Marshal(unified)
		return string(result)

	case "tool_result":
		// Tool result events
		toolID, _ := parsed["tool_id"].(string)
		status, _ := parsed["status"].(string)
		output, _ := parsed["output"].(string)
		isError := status != "success"

		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "gemini",
			"type":     "user",
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{
						"type":        "tool_result",
						"tool_use_id": toolID,
						"content":     output,
						"is_error":    isError,
					},
				},
			},
		}
		result, _ := json.Marshal(unified)
		return string(result)

	case "result":
		// Session completion
		status, _ := parsed["status"].(string)
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "gemini",
			"type":     "result",
			"subtype":  "session_complete",
			"success":  status == "success",
		}
		result, _ := json.Marshal(unified)
		return string(result)
	}

	// Default: pass through with provider info
	parsed["cwd"] = s.Config.ProjectPath
	parsed["provider"] = "gemini"
	result, _ := json.Marshal(parsed)
	return string(result)
}

// waitForCompletion waits for the process to complete
func (s *Session) waitForCompletion(emitter EventEmitter) {
	if s.cmd == nil || s.cmd.Process == nil {
		return
	}

	err := s.cmd.Wait()

	s.mu.Lock()
	if s.cancelled {
		s.Status = "cancelled"
	} else if err != nil {
		s.Status = "failed"
	} else {
		s.Status = "completed"
	}
	s.mu.Unlock()

	close(s.done)

	// Emit completion event
	if emitter != nil {
		completion := map[string]interface{}{
			"success": s.Status == "completed",
			"cwd":     s.Config.ProjectPath,
		}
		completionJSON, _ := json.Marshal(completion)
		log.Printf("[Gemini Session] Emitting claude-complete: status=%s", s.Status)
		emitter.Emit("claude-complete", string(completionJSON))
	}
}

// Terminate terminates the session
func (s *Session) Terminate() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd == nil || s.cmd.Process == nil {
		return fmt.Errorf("no process to terminate")
	}

	s.cancelled = true

	// Try graceful termination first (SIGINT)
	if err := s.cmd.Process.Signal(os.Interrupt); err != nil {
		// Force kill if graceful termination fails
		return s.cmd.Process.Kill()
	}

	return nil
}

// IsRunning checks if the session is still running
func (s *Session) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Status == "running"
}

// GetOutput returns the buffered output
func (s *Session) GetOutput() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.outputBuf)
}

// GetPID returns the process ID
func (s *Session) GetPID() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.cmd != nil && s.cmd.Process != nil {
		return s.cmd.Process.Pid
	}
	return 0
}

// enhanceEnvForProduction returns environment variables with enhanced PATH
// and loads missing API keys from user's login shell environment.
// This is critical for production .app builds where PATH is very limited
// and API keys are not inherited when launched via double-click.
func enhanceEnvForProduction() []string {
	env := os.Environ()

	// Additional paths to add for production builds
	// These are common locations for CLI tools on macOS
	additionalPaths := []string{
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/local/sbin",
		os.Getenv("HOME") + "/.local/bin",
		os.Getenv("HOME") + "/.cargo/bin",
		os.Getenv("HOME") + "/.npm-global/bin",
		os.Getenv("HOME") + "/go/bin",
		"/opt/homebrew/opt/node/bin",
		"/opt/homebrew/opt/python/bin",
	}

	// Find existing PATH and enhance it
	var existingPath string
	var pathIndex = -1
	for i, e := range env {
		if len(e) > 5 && e[:5] == "PATH=" {
			existingPath = e[5:]
			pathIndex = i
			break
		}
	}

	// Build enhanced PATH by prepending additional paths
	var newPath string
	for _, p := range additionalPaths {
		if _, err := os.Stat(p); err == nil {
			if newPath == "" {
				newPath = p
			} else {
				newPath = newPath + ":" + p
			}
		}
	}

	if existingPath != "" {
		newPath = newPath + ":" + existingPath
	}

	// Update or append PATH
	if pathIndex >= 0 {
		env[pathIndex] = "PATH=" + newPath
	} else {
		env = append(env, "PATH="+newPath)
	}

	// Load API keys from Claude settings.json (like Tauri version does)
	// This is the most reliable source for production builds
	env = loadEnvFromClaudeSettings(env, map[string][]string{
		"GEMINI_API_KEY": {"GEMINI_API_KEY"},
		"GOOGLE_API_KEY": {"GOOGLE_API_KEY"},
	})

	// Fallback: Load missing API keys from launchctl or login shell
	env = loadMissingEnvFromSystem(env, []string{
		"GEMINI_API_KEY",
		"GOOGLE_API_KEY",
	})

	return env
}

// loadEnvFromClaudeSettings loads environment variables from ~/.claude/settings.json
func loadEnvFromClaudeSettings(env []string, varMappings map[string][]string) []string {
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		return env
	}

	settingsPath := homeDir + "/.claude/settings.json"
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		log.Printf("[Gemini Session] Could not read Claude settings: %v", err)
		return env
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		log.Printf("[Gemini Session] Could not parse Claude settings: %v", err)
		return env
	}

	envSection, ok := settings["env"].(map[string]interface{})
	if !ok {
		return env
	}

	// Check which vars are already set
	existingVars := make(map[string]bool)
	for _, e := range env {
		for targetVar := range varMappings {
			if len(e) > len(targetVar)+1 && e[:len(targetVar)+1] == targetVar+"=" {
				existingVars[targetVar] = true
				break
			}
		}
	}

	// Load missing vars from Claude settings
	for targetVar, sourceVars := range varMappings {
		if existingVars[targetVar] {
			continue
		}
		for _, sourceVar := range sourceVars {
			if value, ok := envSection[sourceVar].(string); ok && value != "" {
				log.Printf("[Gemini Session] Loaded %s from Claude settings", targetVar)
				env = append(env, targetVar+"="+value)
				break
			}
		}
	}

	return env
}

// loadMissingEnvFromSystem loads missing environment variables from launchctl or login shell
func loadMissingEnvFromSystem(env []string, vars []string) []string {
	// Check which vars are already set
	existingVars := make(map[string]bool)
	for _, e := range env {
		for _, v := range vars {
			if len(e) > len(v)+1 && e[:len(v)+1] == v+"=" {
				existingVars[v] = true
				break
			}
		}
	}

	// Find missing vars
	var missingVars []string
	for _, v := range vars {
		if !existingVars[v] {
			missingVars = append(missingVars, v)
		}
	}

	if len(missingVars) == 0 {
		return env
	}

	for _, varName := range missingVars {
		var value string

		// First, try launchctl (macOS system-wide environment)
		cmd := exec.Command("launchctl", "getenv", varName)
		output, err := cmd.Output()
		if err == nil && len(output) > 0 {
			value = string(output)
			if len(value) > 0 && value[len(value)-1] == '\n' {
				value = value[:len(value)-1]
			}
		}

		// If not in launchctl, try login shell
		if value == "" {
			shell := os.Getenv("SHELL")
			if shell == "" {
				shell = "/bin/zsh"
			}
			cmd = exec.Command(shell, "-l", "-c", "echo $"+varName)
			output, err = cmd.Output()
			if err == nil && len(output) > 1 {
				value = string(output)
				value = value[:len(value)-1] // Remove trailing newline
			}
		}

		if value != "" {
			log.Printf("[Gemini Session] Loaded %s from system environment", varName)
			env = append(env, varName+"="+value)
		}
	}

	return env
}

// setEnvVar sets or updates an environment variable in the env slice
func setEnvVar(env []string, key, value string) []string {
	prefix := key + "="
	for i, e := range env {
		if len(e) >= len(prefix) && e[:len(prefix)] == prefix {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
