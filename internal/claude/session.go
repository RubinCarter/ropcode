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
	"strings"
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
	// InteractiveMode enables long-lived process mode where messages are sent via stdin
	// instead of the batch -p mode
	InteractiveMode bool `json:"interactive_mode,omitempty"`
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
	// Note: No stdin in batch mode - Claude CLI with -p flag doesn't need stdin input
	// In interactive mode, stdin is used to send messages

	outputBuf      []byte
	stderrBuf      []byte // Collect stderr output to show as single error message
	mu             sync.RWMutex
	done           chan struct{}
	cancelled      bool
	processEmitter ProcessChangedEmitter

	// Interactive mode fields
	stdin       io.WriteCloser
	interactive bool
	initialized bool
	initDone    chan struct{}
	processing  bool         // True between system.init and result messages
	emitter     EventEmitter // Save reference for SendMessage to use
}

// EventEmitter interface for emitting events
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

// ProcessChangedEmitter interface for emitting process state changes
type ProcessChangedEmitter interface {
	EmitProcessChanged(event ProcessChangedEvent)
}

// ProcessChangedEvent represents a process state change
type ProcessChangedEvent struct {
	PID      int    `json:"pid"`
	Cwd      string `json:"cwd"`
	State    string `json:"state"` // "running", "stopped"
	ExitCode *int   `json:"exitCode,omitempty"`
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
func (s *Session) Start(ctx context.Context, binaryPath string, emitter EventEmitter, processEmitter ProcessChangedEmitter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == "running" {
		return fmt.Errorf("session already running")
	}

	// Store processEmitter for later use
	s.processEmitter = processEmitter

	// Build command arguments - following the original Rust implementation
	args := []string{}

	if s.Config.InteractiveMode {
		// Interactive mode: long-lived process, messages sent via stdin
		// Do NOT add -p, --resume, --continue arguments
		// Add --input-format for stdin message protocol
		args = append(args, "--input-format", "stream-json")
	} else {
		// Batch mode: single prompt execution
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

	// Log custom API configuration if provided
	// Will be set as environment variables on the command
	if s.Config.BaseURL != "" {
		log.Printf("[Session] Using custom base URL via env var: %s", s.Config.BaseURL)
	}
	if s.Config.AuthToken != "" {
		log.Printf("[Session] Using custom auth token via env var")
	}

	log.Printf("[Session] Starting Claude with args: %v", args)

	// Create command - use project path as working directory (NOT as --project-path arg)
	s.cmd = exec.CommandContext(ctx, binaryPath, args...)

	// Set working directory to project path
	if s.Config.ProjectPath != "" {
		s.cmd.Dir = s.Config.ProjectPath
	}

	// Inherit current environment and ensure full shell PATH
	s.cmd.Env = os.Environ()
	s.cmd.Env = ensureFullShellPath(s.cmd.Env)

	// Add custom API configuration via environment variables
	// This is the recommended approach and avoids FSWatcher issues with --settings
	if s.Config.BaseURL != "" {
		s.cmd.Env = append(s.cmd.Env, fmt.Sprintf("ANTHROPIC_BASE_URL=%s", s.Config.BaseURL))
	}
	if s.Config.AuthToken != "" {
		s.cmd.Env = append(s.cmd.Env, fmt.Sprintf("ANTHROPIC_AUTH_TOKEN=%s", s.Config.AuthToken))
	}

	// Disable non-essential network traffic (telemetry, update checks, etc.)
	// This ensures Claude Code runs in a more controlled/private mode
	s.cmd.Env = append(s.cmd.Env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=true")

	// Setup pipes
	s.stdout, err = s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	s.stderr, err = s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Setup stdin pipe for interactive mode
	if s.Config.InteractiveMode {
		stdinPipe, stdinErr := s.cmd.StdinPipe()
		if stdinErr != nil {
			return fmt.Errorf("failed to create stdin pipe: %w", stdinErr)
		}
		s.stdin = stdinPipe
		s.interactive = true
		s.emitter = emitter
		s.initDone = make(chan struct{})
	}
	// Note: No stdin pipe needed in batch mode - Claude CLI with -p flag operates in non-interactive mode

	// Start the command
	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	s.Status = "running"
	s.StartedAt = time.Now()

	// Emit process started event
	if s.processEmitter != nil {
		s.processEmitter.EmitProcessChanged(ProcessChangedEvent{
			PID:   s.cmd.Process.Pid,
			Cwd:   s.Config.ProjectPath,
			State: "running",
		})
	}

	if s.interactive {
		// Interactive mode: no initial user message broadcast (no prompt yet)
		// Start reading output and watch for process exit
		go s.readOutput(s.stdout, "stdout", emitter)
		go s.readOutput(s.stderr, "stderr", emitter)
		go s.watchProcessExit(emitter)
		// Send initialize request to start the session protocol
		go s.sendInitialize()
	} else {
		// Batch mode: broadcast user message to all clients for multi-client sync
		// This ensures all connected clients (iOS, Mac, Web) see the user's prompt
		if emitter != nil && s.Config.Prompt != "" {
			userMessage := map[string]interface{}{
				"type":       "user",
				"source":     "broadcast",
				"session_id": s.ID,
				"cwd":        s.Config.ProjectPath,
				"timestamp":  time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{
							"type": "text",
							"text": s.Config.Prompt,
						},
					},
				},
			}
			userJSON, _ := json.Marshal(userMessage)
			log.Printf("[Session] Broadcasting user message to all clients: session_id=%s, cwd=%s, prompt=%s", s.ID, s.Config.ProjectPath, s.Config.Prompt)
			emitter.Emit("claude-output", string(userJSON))
		}

		// Start reading output in goroutines
		// Claude CLI will output its own system/init message - we just forward it
		// This matches the Rust implementation which doesn't emit its own init
		go s.readOutput(s.stdout, "stdout", emitter)
		go s.readOutput(s.stderr, "stderr", emitter)
		go s.waitForCompletion(emitter)
	}

	return nil
}

// sendInitialize sends the control_request to initialize the interactive session
func (s *Session) sendInitialize() {
	controlRequest := map[string]interface{}{
		"type":       "control_request",
		"request_id": "init_1",
		"request": map[string]interface{}{
			"subtype": "initialize",
		},
	}
	jsonBytes, err := json.Marshal(controlRequest)
	if err != nil {
		log.Printf("[Session] Failed to marshal initialize request: %v", err)
		return
	}
	jsonBytes = append(jsonBytes, '\n')

	s.mu.Lock()
	if s.stdin == nil {
		s.mu.Unlock()
		return
	}
	stdin := s.stdin
	s.mu.Unlock()

	if _, err := stdin.Write(jsonBytes); err != nil {
		log.Printf("[Session] Failed to send initialize request: %v", err)
	}
}

// WaitForInit blocks until the interactive session is initialized or timeout/error occurs
func (s *Session) WaitForInit(timeout time.Duration) error {
	if !s.interactive {
		return fmt.Errorf("session is not in interactive mode")
	}

	select {
	case <-s.initDone:
		return nil
	case <-s.done:
		return fmt.Errorf("session exited before initialization completed")
	case <-time.After(timeout):
		return fmt.Errorf("initialization timed out after %v", timeout)
	}
}

// SendMessage sends a user message to the interactive Claude CLI process via stdin
func (s *Session) SendMessage(prompt string, emitter EventEmitter) error {
	s.mu.RLock()
	if !s.interactive {
		s.mu.RUnlock()
		return fmt.Errorf("session is not in interactive mode")
	}
	if !s.initialized {
		s.mu.RUnlock()
		return fmt.Errorf("session is not yet initialized")
	}
	if s.Status != "running" {
		s.mu.RUnlock()
		return fmt.Errorf("session is not running")
	}
	stdin := s.stdin
	s.mu.RUnlock()

	// Broadcast user message to all frontend clients (same as existing behavior)
	if emitter != nil {
		userMessage := map[string]interface{}{
			"type":       "user",
			"source":     "broadcast",
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
			"timestamp":  time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{
						"type": "text",
						"text": prompt,
					},
				},
			},
		}
		userJSON, _ := json.Marshal(userMessage)
		emitter.Emit("claude-output", string(userJSON))
	}

	// Construct stdin message
	stdinMessage := map[string]interface{}{
		"type": "user",
		"message": map[string]interface{}{
			"role": "user",
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": prompt,
				},
			},
		},
	}

	jsonBytes, err := json.Marshal(stdinMessage)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}
	jsonBytes = append(jsonBytes, '\n')

	if _, err := stdin.Write(jsonBytes); err != nil {
		return fmt.Errorf("failed to write to stdin: %w", err)
	}

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
		// Collect stderr output to show as single error message when process ends
		if outputType == "stderr" && line != "" {
			log.Printf("[Session] stderr: %s", line)
			s.stderrBuf = append(s.stderrBuf, []byte(line+"\n")...)
		}
		s.mu.Unlock()

		// For stdout, process and emit
		if emitter != nil && outputType == "stdout" {
			// Claude CLI outputs JSONL format - try to parse and enrich with cwd/session_id
			var msg map[string]interface{}
			if err := json.Unmarshal([]byte(line), &msg); err == nil {
				// Interactive mode: filter and track certain message types
				if s.interactive {
					msgType, _ := msg["type"].(string)

					// Handle control_response: mark initialized, do NOT forward
					if msgType == "control_response" {
						s.mu.Lock()
						s.initialized = true
						s.mu.Unlock()
						close(s.initDone)
						log.Printf("[Session] Interactive session initialized (control_response received)")
						continue
					}

					// Handle system messages with specific subtypes
					if msgType == "system" {
						subtype, _ := msg["subtype"].(string)
						// Filter out hook messages - do NOT forward to frontend
						if subtype == "hook_started" || subtype == "hook_response" {
							log.Printf("[Session] Filtering interactive hook message: subtype=%s", subtype)
							continue
						}
						// Track processing state on init
						if subtype == "init" {
							s.mu.Lock()
							s.processing = true
							s.mu.Unlock()
							// Continue to forward this message normally
						}
					}

					// Track processing state on result
					if msgType == "result" {
						s.mu.Lock()
						s.processing = false
						s.mu.Unlock()
						// Continue to forward this message normally
					}
				}

				// Add session_id and cwd to the message for frontend routing
				// In interactive mode, always override session_id with Go-side session ID
				// so frontend can use it for SendClaudeMessage RPC calls
				if s.interactive || msg["session_id"] == nil {
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
				// Not JSON - wrap as raw output message with source info
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

	// Handle scanner errors - add to stderr buffer
	if err := scanner.Err(); err != nil {
		s.mu.Lock()
		s.stderrBuf = append(s.stderrBuf, []byte(fmt.Sprintf("Scanner error: %s\n", err.Error()))...)
		s.mu.Unlock()
	}
}

// waitForCompletion waits for the command to complete
func (s *Session) waitForCompletion(emitter EventEmitter) {
	err := s.cmd.Wait()

	s.mu.Lock()
	pid := s.cmd.Process.Pid
	projectPath := s.Config.ProjectPath
	processEmitter := s.processEmitter

	if s.cancelled {
		s.Status = "cancelled"
	} else if err != nil {
		s.Status = "failed"
		log.Printf("[Session] Claude CLI failed with error: %s", err.Error())
	} else {
		s.Status = "completed"
	}
	stderrOutput := string(s.stderrBuf)
	s.mu.Unlock()

	// Emit process stopped event
	if processEmitter != nil {
		var exitCode int
		if err != nil {
			exitCode = 1
		} else {
			exitCode = 0
		}
		processEmitter.EmitProcessChanged(ProcessChangedEvent{
			PID:      pid,
			Cwd:      projectPath,
			State:    "stopped",
			ExitCode: &exitCode,
		})
	}

	close(s.done)

	// If process failed with error, emit stderr output as single error message
	if err != nil && emitter != nil && !s.cancelled {
		errorMessage := fmt.Sprintf("Claude process failed: %v", err)
		// Include stderr output if available
		if stderrOutput != "" {
			errorMessage = strings.TrimSpace(stderrOutput)
		}

		errMsg := map[string]interface{}{
			"type":       "error",
			"error":      errorMessage,
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
			"provider":   "claude",
		}
		errJSON, _ := json.Marshal(errMsg)
		log.Printf("[Session] Emitting claude-error: %v", err)
		emitter.Emit("claude-error", string(errJSON))
	}

	// Emit completion event with cwd for frontend routing
	if emitter != nil {
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

// watchProcessExit waits for the interactive Claude CLI process to exit
// Unlike waitForCompletion, it doesn't expect the process to end after a single response
func (s *Session) watchProcessExit(emitter EventEmitter) {
	err := s.cmd.Wait()

	s.mu.Lock()
	pid := s.cmd.Process.Pid
	projectPath := s.Config.ProjectPath
	processEmitter := s.processEmitter

	if s.cancelled {
		s.Status = "cancelled"
	} else if err != nil {
		s.Status = "failed"
		log.Printf("[Session] Interactive Claude CLI exited with error: %s", err.Error())
	} else {
		s.Status = "completed"
	}
	stderrOutput := string(s.stderrBuf)
	s.mu.Unlock()

	// Emit process stopped event
	if processEmitter != nil {
		var exitCode int
		if err != nil {
			exitCode = 1
		} else {
			exitCode = 0
		}
		processEmitter.EmitProcessChanged(ProcessChangedEvent{
			PID:      pid,
			Cwd:      projectPath,
			State:    "stopped",
			ExitCode: &exitCode,
		})
	}

	close(s.done)

	// If process failed unexpectedly, emit error
	if err != nil && emitter != nil && !s.cancelled {
		errorMessage := fmt.Sprintf("Claude process exited unexpectedly: %v", err)
		if stderrOutput != "" {
			errorMessage = strings.TrimSpace(stderrOutput)
		}

		errMsg := map[string]interface{}{
			"type":       "error",
			"error":      errorMessage,
			"session_id": s.ID,
			"cwd":        s.Config.ProjectPath,
			"provider":   "claude",
		}
		errJSON, _ := json.Marshal(errMsg)
		emitter.Emit("claude-error", string(errJSON))
	}

	// Emit completion event
	if emitter != nil {
		completeMsg := map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"success":    s.Status == "completed",
			"status":     s.Status,
			"session_id": s.ID,
		}
		completeJSON, _ := json.Marshal(completeMsg)
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

	// In interactive mode, close stdin first to signal the process to stop
	if s.interactive && s.stdin != nil {
		s.stdin.Close()
	}

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

// IsInteractive returns whether the session is in interactive mode
func (s *Session) IsInteractive() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.interactive
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

// ensureFullShellPath ensures the environment has the full PATH from user's login shell.
// This is necessary because GUI apps (like Electron) don't inherit shell PATH on macOS.
func ensureFullShellPath(env []string) []string {
	// Get user's default shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh" // Default on modern macOS
	}

	// Execute login shell to get the full PATH
	// Using -l (login) and -c to run a command
	cmd := exec.Command(shell, "-l", "-c", "echo $PATH")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("[Session] Failed to get shell PATH: %v, using current PATH", err)
		return env
	}

	shellPath := strings.TrimSpace(string(output))
	if shellPath == "" {
		return env
	}

	// Update or append PATH in the environment
	pathFound := false
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = "PATH=" + shellPath
			pathFound = true
			log.Printf("[Session] Updated PATH from login shell")
			break
		}
	}

	if !pathFound {
		env = append(env, "PATH="+shellPath)
		log.Printf("[Session] Added PATH from login shell")
	}

	return env
}
