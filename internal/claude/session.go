// internal/claude/session.go
package claude

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
	Continue      bool   `json:"continue,omitempty"`
	// ThinkingLevel specifies the thinking depth for extended thinking models
	// Can be "auto" or a specific budget number as string
	ThinkingLevel string `json:"thinking_level,omitempty"`
	// API configuration from ProviderApiConfig
	BaseURL   string `json:"base_url,omitempty"`
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
	// Note: No stdin - Claude CLI with -p flag doesn't need stdin input
	// This matches the Rust implementation which only configures stdout/stderr

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

// Start starts the Claude session
func (s *Session) Start(ctx context.Context, binaryPath string, emitter EventEmitter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == "running" {
		return fmt.Errorf("session already running")
	}

	// Build command arguments - following the original Rust implementation
	args := []string{}

	// Add resume/continue flags first (before prompt)
	// --resume requires a session ID value
	if s.Config.Resume && s.Config.SessionID != "" {
		args = append(args, "--resume", s.Config.SessionID)
	}
	if s.Config.Continue {
		args = append(args, "--continue")
	}

	// Add prompt with -p flag (non-interactive print mode)
	if s.Config.Prompt != "" {
		args = append(args, "-p", s.Config.Prompt)
	}

	// Add model if specified
	if s.Config.Model != "" {
		args = append(args, "--model", s.Config.Model)
	}

	// Note: Thinking depth for Claude is handled via prompt engineering in frontend
	// The frontend appends phrases like "think", "think hard", "ultrathink" to the prompt
	// ThinkingLevel field is kept for compatibility but not used in CLI args for Claude

	// Add output format for JSONL streaming
	args = append(args, "--output-format", "stream-json")

	// Add verbose flag
	args = append(args, "--verbose")

	// Skip permission checks for automated execution
	args = append(args, "--dangerously-skip-permissions")

	// Add ~/.claude/ to allowed directories for file access
	homeDir, err := os.UserHomeDir()
	if err == nil {
		claudeDir := homeDir + "/.claude"
		if _, statErr := os.Stat(claudeDir); statErr == nil {
			args = append(args, "--add-dir", claudeDir)
		}
	}

	log.Printf("[Session] Starting Claude with args: %v", args)

	// Create command - use project path as working directory (NOT as --project-path arg)
	s.cmd = exec.CommandContext(ctx, binaryPath, args...)

	// Set working directory to project path
	if s.Config.ProjectPath != "" {
		s.cmd.Dir = s.Config.ProjectPath
	}

	// Set environment variables for custom API configuration
	// Inherit current environment and add/override API config
	s.cmd.Env = os.Environ()
	if s.Config.AuthToken != "" {
		s.cmd.Env = append(s.cmd.Env, "ANTHROPIC_API_KEY="+s.Config.AuthToken)
		log.Printf("[Session] Using custom API key from provider config")
	}
	if s.Config.BaseURL != "" {
		s.cmd.Env = append(s.cmd.Env, "ANTHROPIC_BASE_URL="+s.Config.BaseURL)
		log.Printf("[Session] Using custom base URL: %s", s.Config.BaseURL)
	}

	// Setup pipes
	s.stdout, err = s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	s.stderr, err = s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Note: No stdin pipe needed - Claude CLI with -p flag operates in non-interactive mode
	// This matches the Rust implementation which only configures stdout/stderr

	// Start the command
	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	s.Status = "running"
	s.StartedAt = time.Now()

	// Start reading output in goroutines
	// Claude CLI will output its own system/init message - we just forward it
	// This matches the Rust implementation which doesn't emit its own init
	go s.readOutput(s.stdout, "stdout", emitter)
	go s.readOutput(s.stderr, "stderr", emitter)
	go s.waitForCompletion(emitter)

	return nil
}

// readOutput reads output from stdout or stderr
// Claude CLI outputs JSONL format - each line is a complete JSON message
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
			// Claude CLI outputs JSONL format - try to parse and enrich with cwd/session_id
			var msg map[string]interface{}
			if err := json.Unmarshal([]byte(line), &msg); err == nil {
				// Add session_id and cwd to the message for frontend routing
				if msg["session_id"] == nil {
					msg["session_id"] = s.ID
				}
				if msg["cwd"] == nil {
					msg["cwd"] = s.Config.ProjectPath
				}
				// Re-marshal and send as JSON string
				enrichedJSON, _ := json.Marshal(msg)
				log.Printf("[Session] Emitting claude-output (%s): type=%v", outputType, msg["type"])
				emitter.Emit("claude-output", string(enrichedJSON))
			} else {
				// Not JSON - wrap as raw output message
				rawMsg := map[string]interface{}{
					"type":       "raw",
					"source":     outputType,
					"content":    line,
					"session_id": s.ID,
					"cwd":        s.Config.ProjectPath,
				}
				rawJSON, _ := json.Marshal(rawMsg)
				log.Printf("[Session] Emitting raw output (%s): %s", outputType, line)
				emitter.Emit("claude-output", string(rawJSON))
			}
		}
	}

	if err := scanner.Err(); err != nil && emitter != nil {
		errMsg := map[string]interface{}{
			"type":       "error",
			"error":      err.Error(),
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
		}
		errJSON, _ := json.Marshal(errMsg)
		log.Printf("[Session] Emitting claude-error: %s", err.Error())
		emitter.Emit("claude-error", string(errJSON))
	}
}

// waitForCompletion waits for the command to complete
func (s *Session) waitForCompletion(emitter EventEmitter) {
	err := s.cmd.Wait()

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cancelled {
		s.Status = "cancelled"
	} else if err != nil {
		s.Status = "failed"
	} else {
		s.Status = "completed"
	}

	close(s.done)

	if emitter != nil {
		// Emit completion event with cwd for frontend routing
		completeMsg := map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"success":    s.Status == "completed",
			"status":     s.Status,
			"session_id": s.ID,
		}
		completeJSON, _ := json.Marshal(completeMsg)
		log.Printf("[Session] Emitting claude-complete: status=%s", s.Status)
		emitter.Emit("claude-complete", string(completeJSON))
	}
}

// Terminate terminates the running session
func (s *Session) Terminate() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd == nil || s.cmd.Process == nil {
		return fmt.Errorf("no running process")
	}

	s.cancelled = true

	// Try graceful termination first
	if err := s.cmd.Process.Signal(os.Interrupt); err != nil {
		// If graceful termination fails, force kill
		return s.cmd.Process.Kill()
	}

	// Wait a bit for graceful termination
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()

	select {
	case <-s.done:
		return nil
	case <-timer.C:
		// Force kill if graceful termination didn't work
		return s.cmd.Process.Kill()
	}
}

// GetOutput returns the accumulated output
func (s *Session) GetOutput() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.outputBuf)
}

// IsRunning returns whether the session is currently running
func (s *Session) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Status == "running"
}

// GetStatus returns the current session status
func (s *Session) GetStatus() *SessionStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := &SessionStatus{
		SessionID:   s.ID,
		ProjectPath: s.Config.ProjectPath,
		Model:       s.Config.Model,
		Status:      s.Status,
		StartedAt:   s.StartedAt,
	}

	if s.cmd != nil && s.cmd.Process != nil {
		status.PID = s.cmd.Process.Pid
	}

	return status
}
