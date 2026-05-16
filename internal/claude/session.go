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
	"ropcode/internal/sessionproc"
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
	// ResumeClaudeSessionID is the Claude-side session ID to resume in interactive mode.
	// When set, --resume <id> is passed to Claude CLI so the conversation history is restored.
	ResumeClaudeSessionID string `json:"resume_claude_session_id,omitempty"`
	// DisableAutoResume prevents manager-level fallback to the last completed Claude conversation.
	DisableAutoResume bool `json:"disable_auto_resume,omitempty"`
	// API configuration from ProviderApiConfig
	BaseURL   string `json:"base_url,omitempty"`
	AuthToken string `json:"auth_token,omitempty"`
}

// ToolProgress holds progress info for an active tool call.
type ToolProgress struct {
	ToolName    string  `json:"tool_name,omitempty"`
	Step        int     `json:"step,omitempty"`
	TotalSteps  int     `json:"total_steps,omitempty"`
	Percent     float64 `json:"percent,omitempty"`
	Description string  `json:"description,omitempty"`
}

// ApiRetryInfo holds details about the most recent API retry attempt.
type ApiRetryInfo struct {
	Reason       string `json:"reason,omitempty"` // e.g. "rate_limit", "server_error"
	Attempt      int    `json:"attempt,omitempty"`
	MaxAttempts  int    `json:"max_attempts,omitempty"`
	RetryAfterMs int    `json:"retry_after_ms,omitempty"`
	ErrorStatus  int    `json:"error_status,omitempty"`
}

// RuntimeState tracks fine-grained Claude session activity derived from the JSONL stream.
// It is injected into every claude-output event so the frontend can show real-time status.
type RuntimeState struct {
	Processing            bool          `json:"processing"`
	Retrying              bool          `json:"retrying"`
	RateLimited           bool          `json:"rate_limited"`
	Status                string        `json:"status,omitempty"`
	ActiveTool            string        `json:"active_tool,omitempty"`
	ActiveToolProgress    *ToolProgress `json:"active_tool_progress,omitempty"`
	LastApiRetry          *ApiRetryInfo `json:"last_api_retry,omitempty"`
	LastThinkingPhase     string        `json:"last_thinking_phase,omitempty"`
	LastPartialTextLength int           `json:"last_partial_text_length,omitempty"`
	LastEventType         string        `json:"last_event_type,omitempty"`
	LastEventSubtype      string        `json:"last_event_subtype,omitempty"`
}

type SessionStatus struct {
	SessionID   string       `json:"session_id"`
	ProjectPath string       `json:"project_path"`
	Model       string       `json:"model"`
	Status      string       `json:"status"` // "running", "completed", "failed", "cancelled"
	StartedAt   time.Time    `json:"started_at"`
	PID         int          `json:"pid,omitempty"`
	Runtime     RuntimeState `json:"runtime,omitempty"`
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
	stdin                  io.WriteCloser
	interactive            bool
	initialized            bool
	initDone               chan struct{}
	runtime                RuntimeState // Fine-grained activity state derived from JSONL stream
	emitter                EventEmitter // Save reference for SendMessage to use
	claudeSessionID        string       // The Claude-side session ID (from system.init), used for --resume
	activityObserver       ActivityObserver
	initDoneClosed         bool
	pendingControlRequests map[string]chan controlResponseResult
	controlRequestSeq      uint64
}

// controlResponseResult is delivered when a previously sent control_request
// receives its matching control_response from the Claude CLI.
type controlResponseResult struct {
	response map[string]interface{}
	err      error
}

// EventEmitter interface for emitting events
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

// ProcessChangedEmitter interface for emitting process state changes
type ProcessChangedEmitter interface {
	EmitProcessChanged(event ProcessChangedEvent)
}

type ActivityObserver interface {
	ObserveClaudeEvent(sessionID string, event map[string]interface{})
	CompleteSession(sessionID string)
	HandleControlResponse(sessionID string, response map[string]interface{})
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
		ID:                     sessionID,
		Config:                 config,
		Status:                 "created",
		StartedAt:              time.Now(),
		outputBuf:              make([]byte, 0),
		done:                   make(chan struct{}),
		cancelled:              false,
		pendingControlRequests: make(map[string]chan controlResponseResult),
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

	args := buildClaudeArgs(s.Config)

	log.Printf("[Session] Starting Claude: binary=%q cwd=%q interactive=%t resumeClaudeSession=%q args=%q",
		binaryPath,
		s.Config.ProjectPath,
		s.Config.InteractiveMode,
		s.Config.ResumeClaudeSessionID,
		args,
	)

	// Create command - use project path as working directory (NOT as --project-path arg)
	s.cmd = exec.CommandContext(ctx, binaryPath, args...)
	if err := sessionproc.Configure(s.cmd); err != nil {
		return fmt.Errorf("failed to configure command: %w", err)
	}

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
		log.Printf("[Session] Using custom base URL via env var: %s", s.Config.BaseURL)
		s.cmd.Env = append(s.cmd.Env, fmt.Sprintf("ANTHROPIC_BASE_URL=%s", s.Config.BaseURL))
	}
	if s.Config.AuthToken != "" {
		log.Printf("[Session] Using custom auth token via env var")
		s.cmd.Env = append(s.cmd.Env, fmt.Sprintf("ANTHROPIC_AUTH_TOKEN=%s", s.Config.AuthToken))
	}

	// Disable non-essential network traffic (telemetry, update checks, etc.)
	// This ensures Claude Code runs in a more controlled/private mode
	s.cmd.Env = append(s.cmd.Env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=true")

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
	if err := sessionproc.Start(s.cmd); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}
	log.Printf("[Session] Claude process started: pid=%d session=%s cwd=%q", s.cmd.Process.Pid, s.ID, s.Config.ProjectPath)

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
				"type":   "user",
				"source": "broadcast",
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
			s.enrichOutputMessage(userMessage)
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

func buildClaudeArgs(config SessionConfig) []string {
	args := []string{}

	if config.InteractiveMode {
		// Claude only honors stream-json stdin/stdout in print mode. Without --print,
		// recent CLI versions can show interactive trust prompts and never complete init.
		args = append(args, "--print")
		// Interactive mode: long-lived process, messages sent via stdin
		// Add --input-format for stdin message protocol
		args = append(args, "--input-format", "stream-json")
		// Resume previous conversation if a Claude session ID is provided
		if config.ResumeClaudeSessionID != "" {
			args = append(args, "--resume", config.ResumeClaudeSessionID)
			log.Printf("[Session] Resuming Claude conversation with session ID: %s", config.ResumeClaudeSessionID)
		}
	} else {
		// Batch mode: single prompt execution
		// Add resume/continue flags first (before prompt)
		// --resume requires a session ID value
		if config.Resume && config.SessionID != "" {
			args = append(args, "--resume", config.SessionID)
		}
		if config.Continue {
			args = append(args, "--continue")
		}

		// Add prompt with -p flag (non-interactive print mode)
		if config.Prompt != "" {
			args = append(args, "-p", config.Prompt)
		}
	}

	// Add model if specified
	if config.Model != "" {
		args = append(args, "--model", config.Model)
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

	return args
}

// sendInitialize sends the control_request to initialize the interactive session
func (s *Session) sendInitialize() {
	controlRequest := controlRequestMessage("init_1", "initialize", "")
	s.writeControlRequest(controlRequest, "initialize")
}

func controlRequestMessage(requestID, subtype, taskID string) map[string]interface{} {
	request := map[string]interface{}{
		"subtype": subtype,
	}
	if taskID != "" {
		request["task_id"] = taskID
	}
	return map[string]interface{}{
		"type":       "control_request",
		"request_id": requestID,
		"request":    request,
	}
}

func (s *Session) writeControlRequest(controlRequest map[string]interface{}, label string) error {
	jsonBytes, err := json.Marshal(controlRequest)
	if err != nil {
		log.Printf("[Session] Failed to marshal %s request: %v", label, err)
		return fmt.Errorf("failed to marshal %s request: %w", label, err)
	}
	jsonBytes = append(jsonBytes, '\n')

	s.mu.Lock()
	if s.stdin == nil {
		s.mu.Unlock()
		return fmt.Errorf("session stdin is not available")
	}
	stdin := s.stdin
	s.mu.Unlock()

	if _, err := stdin.Write(jsonBytes); err != nil {
		log.Printf("[Session] Failed to send %s request: %v", label, err)
		return fmt.Errorf("failed to send %s request: %w", label, err)
	}
	return nil
}

func (s *Session) SendStopTaskRequest(requestID, taskID string) error {
	if requestID == "" || taskID == "" {
		return fmt.Errorf("request id and task id are required")
	}

	s.mu.RLock()
	interactive := s.interactive
	running := s.Status == "running"
	s.mu.RUnlock()
	if !interactive {
		return fmt.Errorf("session is not in interactive mode")
	}
	if !running {
		return fmt.Errorf("session is not running")
	}

	return s.writeControlRequest(controlRequestMessage(requestID, "stop_task", taskID), "stop_task")
}

// nextControlRequestID returns a unique request_id for control requests routed
// to/from this session. Concurrent calls return distinct ids.
func (s *Session) nextControlRequestID(prefix string) string {
	s.mu.Lock()
	s.controlRequestSeq++
	seq := s.controlRequestSeq
	s.mu.Unlock()
	return fmt.Sprintf("ropcode-%s-%d", prefix, seq)
}

// sendInteractiveControlRequest sends an arbitrary control_request and blocks
// until the matching control_response is received or the timeout fires. It
// requires the session to be interactive, initialized, and running.
//
// timeout = 0 disables the timeout (use with care; falls back to session done
// signal so we never leak goroutines).
func (s *Session) sendInteractiveControlRequest(prefix, label string, request map[string]interface{}, timeout time.Duration) (map[string]interface{}, error) {
	s.mu.RLock()
	interactive := s.interactive
	initialized := s.initialized
	running := s.Status == "running"
	s.mu.RUnlock()
	if !interactive {
		return nil, fmt.Errorf("session is not in interactive mode")
	}
	if !initialized {
		return nil, fmt.Errorf("session is not yet initialized")
	}
	if !running {
		return nil, fmt.Errorf("session is not running")
	}

	requestID := s.nextControlRequestID(prefix)
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": requestID,
		"request":    request,
	}

	resultCh := make(chan controlResponseResult, 1)

	s.mu.Lock()
	if s.pendingControlRequests == nil {
		s.pendingControlRequests = make(map[string]chan controlResponseResult)
	}
	s.pendingControlRequests[requestID] = resultCh
	s.mu.Unlock()

	cleanup := func() {
		s.mu.Lock()
		delete(s.pendingControlRequests, requestID)
		s.mu.Unlock()
	}

	if err := s.writeControlRequest(envelope, label); err != nil {
		cleanup()
		return nil, err
	}

	var timeoutCh <-chan time.Time
	if timeout > 0 {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		timeoutCh = timer.C
	}

	select {
	case res := <-resultCh:
		if res.err != nil {
			return nil, res.err
		}
		return res.response, nil
	case <-s.done:
		cleanup()
		return nil, fmt.Errorf("session ended before %s control response was received", label)
	case <-timeoutCh:
		cleanup()
		return nil, fmt.Errorf("%s control request timed out after %s", label, timeout)
	}
}

// SetModel switches the model for subsequent conversation turns without
// restarting the Claude CLI process. Pass an empty string or "default" to
// reset to the CLI's default model. Updates Session.Config.Model on success
// so future status snapshots reflect the new model.
func (s *Session) SetModel(model string) error {
	request := map[string]interface{}{
		"subtype": "set_model",
	}
	requested := strings.TrimSpace(model)
	if requested != "" && requested != "default" {
		request["model"] = requested
	}

	if _, err := s.sendInteractiveControlRequest("set-model", "set_model", request, 10*time.Second); err != nil {
		return err
	}

	s.mu.Lock()
	s.Config.Model = requested
	s.mu.Unlock()
	return nil
}

// SetPermissionMode switches the permission mode for tool execution. Valid
// modes match the Claude CLI: "default", "acceptEdits", "bypassPermissions",
// "plan", "dontAsk".
func (s *Session) SetPermissionMode(mode string) error {
	mode = strings.TrimSpace(mode)
	switch mode {
	case "default", "acceptEdits", "bypassPermissions", "plan", "dontAsk":
		// ok
	default:
		return fmt.Errorf("invalid permission mode: %q", mode)
	}

	request := map[string]interface{}{
		"subtype": "set_permission_mode",
		"mode":    mode,
	}
	_, err := s.sendInteractiveControlRequest("set-permission-mode", "set_permission_mode", request, 10*time.Second)
	return err
}

// Interrupt asks the Claude CLI to abort the currently running conversation
// turn without killing the process. The session remains usable afterward.
func (s *Session) Interrupt() error {
	request := map[string]interface{}{
		"subtype": "interrupt",
	}
	_, err := s.sendInteractiveControlRequest("interrupt", "interrupt", request, 10*time.Second)
	return err
}

// UpdateEnvironmentVariables pushes a {key: value} map into the Claude CLI
// process via the stdin `update_environment_variables` message type. Values
// are applied directly to process.env inside the CLI, so the next API call
// will pick up new values for env-driven settings such as ANTHROPIC_BASE_URL,
// ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_CUSTOM_HEADERS, and the
// CLAUDE_CODE_USE_BEDROCK / VERTEX / FOUNDRY toggles.
//
// Caveats (verified against claude-code-source-code/src):
//   - This message has no control_response. We fire-and-forget after writing
//     it. Any failure surfaces only as a stdin write error.
//   - It is applied per-message; we do not buffer or de-dup.
//   - It does not interrupt the current turn — call Interrupt() first if the
//     caller wants the next API request to use the new values immediately.
//   - Empty-string values are forwarded verbatim. The CLI sets process.env[k]
//     to the empty string, which getAPIProvider() and similar helpers treat as
//     "unset" via isEnvTruthy.
func (s *Session) UpdateEnvironmentVariables(variables map[string]string) error {
	if len(variables) == 0 {
		return fmt.Errorf("no environment variables to update")
	}
	for k := range variables {
		if k == "" {
			return fmt.Errorf("environment variable name cannot be empty")
		}
	}

	s.mu.RLock()
	interactive := s.interactive
	initialized := s.initialized
	running := s.Status == "running"
	stdin := s.stdin
	s.mu.RUnlock()
	if !interactive {
		return fmt.Errorf("session is not in interactive mode")
	}
	if !initialized {
		return fmt.Errorf("session is not yet initialized")
	}
	if !running {
		return fmt.Errorf("session is not running")
	}
	if stdin == nil {
		return fmt.Errorf("session stdin is not available")
	}

	envelope := map[string]interface{}{
		"type":      "update_environment_variables",
		"variables": variables,
	}

	jsonBytes, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("failed to marshal update_environment_variables: %w", err)
	}
	jsonBytes = append(jsonBytes, '\n')

	if _, err := stdin.Write(jsonBytes); err != nil {
		return fmt.Errorf("failed to write update_environment_variables to stdin: %w", err)
	}

	keys := make([]string, 0, len(variables))
	for k := range variables {
		keys = append(keys, k)
	}
	log.Printf("[Session] Pushed update_environment_variables to session %s: keys=%v", s.ID, keys)
	return nil
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
		s.mu.RLock()
		stderr := strings.TrimSpace(string(s.stderrBuf))
		s.mu.RUnlock()
		if stderr != "" {
			return fmt.Errorf("session exited before initialization completed: %s", stderr)
		}
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
		log.Printf("[SendMessage] Session %s not yet initialized", s.ID)
		return fmt.Errorf("session is not yet initialized")
	}
	if s.Status != "running" {
		s.mu.RUnlock()
		log.Printf("[SendMessage] Session %s status is not running: %s", s.ID, s.Status)
		return fmt.Errorf("session is not running")
	}
	stdin := s.stdin
	s.mu.RUnlock()

	log.Printf("[SendMessage] Sending to session %s: %s", s.ID, prompt[:min(50, len(prompt))])

	// Broadcast user message to all frontend clients (same as existing behavior)
	if emitter != nil {
		userMessage := map[string]interface{}{
			"type":   "user",
			"source": "broadcast",
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
		s.enrichOutputMessage(userMessage)
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
	buffered := bufio.NewReader(reader)

	for {
		lineBytes, err := buffered.ReadBytes('\n')
		if len(lineBytes) > 0 {
			s.processOutputLine(lineBytes, outputType, emitter)
		}

		if err != nil {
			if err != io.EOF {
				s.handleOutputReadError(err, outputType, emitter)
			}
			return
		}
	}
}

func (s *Session) processOutputLine(lineBytes []byte, outputType string, emitter EventEmitter) {
	line := strings.TrimRight(string(lineBytes), "\r\n")

	s.mu.Lock()
	s.outputBuf = append(s.outputBuf, []byte(line+"\n")...)
	// Collect stderr output to show as single error message when process ends
	if outputType == "stderr" && line != "" {
		log.Printf("[Session] stderr: %s", line)
		s.stderrBuf = append(s.stderrBuf, []byte(line+"\n")...)
	}
	s.mu.Unlock()

	// For stdout, process and emit
	if emitter == nil || outputType != "stdout" {
		return
	}

	// Claude CLI outputs JSONL format - try to parse and enrich with cwd/session_id
	var msg map[string]interface{}
	if err := json.Unmarshal([]byte(line), &msg); err == nil {
		// Update runtime state from every message (batch + interactive)
		s.updateRuntimeStateFromMessage(msg)

		// Interactive mode: filter and track certain message types
		if s.interactive {
			msgType, _ := msg["type"].(string)

			if s.activityObserver != nil {
				s.activityObserver.ObserveClaudeEvent(s.ID, msg)
			}

			// Handle control_response: route by request_id, do NOT forward
			if msgType == "control_response" {
				s.handleControlResponse(msg)
				return
			}

			// Preserve hook events for fidelity, but hide them from default display.
			if msgType == "system" {
				subtype, _ := msg["subtype"].(string)
				if subtype == "hook_started" || subtype == "hook_response" {
					msg["hidden_by_default"] = true
				}
			}
		}

		// Save Claude's own session_id before overriding, so we can use it for --resume later
		if s.interactive {
			if claudeID, ok := msg["session_id"].(string); ok && claudeID != "" {
				s.mu.Lock()
				if s.claudeSessionID == "" {
					s.claudeSessionID = claudeID
					log.Printf("[Session] Captured Claude session ID for resume: %s", claudeID)
				}
				s.mu.Unlock()

				// For system.init, expose the real Claude session ID as claude_session_id
				// so the frontend can persist it (via SessionPersistenceService) and use it
				// to resume the conversation after the process is stopped and restarted.
				msgType, _ := msg["type"].(string)
				subtype, _ := msg["subtype"].(string)
				if msgType == "system" && subtype == "init" {
					msg["claude_session_id"] = claudeID
				}
			}
		}

		s.enrichOutputMessage(msg)

		// Re-marshal and send as JSON string
		enrichedJSON, _ := json.Marshal(msg)
		log.Printf("[Session] Emitting claude-output (%s): type=%v subtype=%v", outputType, msg["type"], msg["subtype"])
		emitter.Emit("claude-output", string(enrichedJSON))
	} else {
		// Not JSON - wrap as raw output message with source info
		rawMsg := map[string]interface{}{
			"type":    "raw",
			"source":  outputType,
			"content": line,
		}
		s.enrichOutputMessage(rawMsg)
		rawJSON, _ := json.Marshal(rawMsg)
		log.Printf("[Session] Emitting raw output (%s): %s", outputType, line)
		emitter.Emit("claude-output", string(rawJSON))
	}
}

func (s *Session) handleControlResponse(msg map[string]interface{}) bool {
	requestID, _ := msg["request_id"].(string)

	if requestID != "" {
		s.mu.Lock()
		ch, ok := s.pendingControlRequests[requestID]
		if ok {
			delete(s.pendingControlRequests, requestID)
		}
		s.mu.Unlock()
		if ok {
			ch <- controlResponseResult{response: msg, err: extractControlResponseError(msg)}
			log.Printf("[Session] Delivered control_response to pending waiter: request_id=%s", requestID)
			return true
		}
	}

	if requestID == "init_1" || s.shouldTreatControlResponseAsInitFallback(requestID) {
		s.markInitialized()
		log.Printf("[Session] Interactive session initialized (control_response received, request_id=%q)", requestID)
		return true
	}

	if s.activityObserver != nil {
		s.activityObserver.HandleControlResponse(s.ID, msg)
		log.Printf("[Session] Routed control_response to activity observer: request_id=%s", requestID)
		return true
	}

	log.Printf("[Session] Unknown control_response request_id=%s", requestID)
	return true
}

// extractControlResponseError extracts an error from a control_response, if any.
// The Claude CLI envelope is:
//
//	{ "type": "control_response",
//	  "response": { "subtype": "success" | "error",
//	                "request_id": "...",
//	                "error": "..." } }
//
// Some payloads also carry inner errors at top level.
func extractControlResponseError(msg map[string]interface{}) error {
	if response, ok := msg["response"].(map[string]interface{}); ok {
		subtype, _ := response["subtype"].(string)
		if subtype == "error" {
			if errText, _ := response["error"].(string); errText != "" {
				return fmt.Errorf("%s", errText)
			}
			return fmt.Errorf("control_request failed")
		}
	}
	if errText, _ := msg["error"].(string); errText != "" {
		return fmt.Errorf("%s", errText)
	}
	return nil
}

func (s *Session) shouldTreatControlResponseAsInitFallback(requestID string) bool {
	if requestID != "" {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.interactive && !s.initialized && s.initDone != nil
}

func (s *Session) markInitialized() {
	s.mu.Lock()
	s.initialized = true
	shouldClose := s.initDone != nil && !s.initDoneClosed
	if shouldClose {
		s.initDoneClosed = true
	}
	s.mu.Unlock()

	if shouldClose {
		close(s.initDone)
	}
}

func (s *Session) handleOutputReadError(err error, outputType string, emitter EventEmitter) {
	errorText := fmt.Sprintf("%s read error: %s", outputType, err.Error())
	s.mu.Lock()
	s.stderrBuf = append(s.stderrBuf, []byte(errorText+"\n")...)
	s.mu.Unlock()

	if emitter == nil || outputType != "stdout" {
		return
	}

	rawMsg := map[string]interface{}{
		"type":     "raw",
		"source":   outputType,
		"content":  errorText,
		"is_error": true,
	}
	s.enrichOutputMessage(rawMsg)
	rawJSON, _ := json.Marshal(rawMsg)
	emitter.Emit("claude-output", string(rawJSON))
}

func (s *Session) enrichOutputMessage(msg map[string]interface{}) {
	// Add session_id and cwd to the message for frontend routing.
	// In interactive mode, always override session_id with Go-side session ID
	// so frontend can use it for SendClaudeMessage RPC calls.
	if s.interactive || msg["session_id"] == nil {
		msg["session_id"] = s.ID
	}
	if msg["cwd"] == nil {
		msg["cwd"] = s.Config.ProjectPath
	}
	if msg["timestamp"] == nil {
		msg["timestamp"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	if msg["provider"] == nil {
		msg["provider"] = "claude"
	}

	// Inject runtime state so frontend can show fine-grained activity status.
	// Old clients ignore unknown fields; new clients can read processing/debug_meta.
	s.mu.RLock()
	runtimeCopy := s.runtime
	s.mu.RUnlock()
	msg["processing"] = runtimeCopy.Processing

	debugMeta, _ := msg["debug_meta"].(map[string]interface{})
	if debugMeta == nil {
		debugMeta = map[string]interface{}{}
	}
	debugMeta["runtime_state"] = runtimeCopy
	if msg["hidden_by_default"] == true {
		debugMeta["hidden_by_default"] = true
	}
	msg["debug_meta"] = debugMeta
}

// updateRuntimeStateFromMessage updates s.runtime based on a parsed JSONL message.
// Called for every stdout JSON line in both batch and interactive modes.
// Must NOT be called while s.mu is held by the caller.
func (s *Session) updateRuntimeStateFromMessage(msg map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()

	t, _ := msg["type"].(string)
	subtype, _ := msg["subtype"].(string)
	s.runtime.LastEventType = t
	s.runtime.LastEventSubtype = subtype

	switch t {
	case "system":
		switch subtype {
		case "init":
			s.runtime.Processing = true
			s.runtime.Retrying = false
			s.runtime.RateLimited = false
			s.runtime.ActiveTool = ""
			s.runtime.ActiveToolProgress = nil
			s.runtime.LastApiRetry = nil

		case "api_retry":
			attempt, _ := msg["attempt"].(float64)
			maxRetries, _ := msg["max_retries"].(float64)
			delayMs, _ := msg["retry_delay_ms"].(float64)
			errorStatus, _ := msg["error_status"].(float64)
			reason, _ := msg["error"].(string)
			s.runtime.Retrying = true
			s.runtime.LastApiRetry = &ApiRetryInfo{
				Reason:       reason,
				Attempt:      int(attempt),
				MaxAttempts:  int(maxRetries),
				RetryAfterMs: int(delayMs),
				ErrorStatus:  int(errorStatus),
			}

		case "status":
			if status, _ := msg["status"].(string); status == "compacting" {
				s.runtime.Status = "compacting"
				s.runtime.Processing = true
			} else {
				s.runtime.Status = ""
			}

		case "task_started":
			s.runtime.Processing = true

		case "task_notification":
			// Task ended; clear active tool if nothing else is running
			s.runtime.ActiveTool = ""
			s.runtime.ActiveToolProgress = nil

		case "error":
			s.runtime.Processing = false
			s.runtime.Retrying = false
			s.runtime.ActiveTool = ""
			s.runtime.ActiveToolProgress = nil
		}

	case "rate_limit_event":
		if info, ok := msg["rate_limit_info"].(map[string]interface{}); ok {
			status, _ := info["status"].(string)
			if status == "allowed_warning" || status == "rejected" {
				s.runtime.RateLimited = true
			} else if status == "allowed" {
				s.runtime.RateLimited = false
			}
		}

	case "tool_progress":
		toolName, _ := msg["tool_name"].(string)
		elapsed, _ := msg["elapsed_time_seconds"].(float64)
		if toolName != "" {
			s.runtime.ActiveTool = toolName
			s.runtime.Processing = true
			s.runtime.ActiveToolProgress = &ToolProgress{
				ToolName:    toolName,
				Description: fmt.Sprintf("%.1fs", elapsed),
			}
		}

	case "assistant":
		// Scan content blocks for tool_use (tool starting) and text length
		if m, ok := msg["message"].(map[string]interface{}); ok {
			if content, ok := m["content"].([]interface{}); ok {
				totalText := 0
				for _, c := range content {
					part, ok := c.(map[string]interface{})
					if !ok {
						continue
					}
					switch part["type"] {
					case "tool_use":
						if name, _ := part["name"].(string); name != "" {
							s.runtime.ActiveTool = name
							s.runtime.Processing = true
						}
					case "text":
						if txt, _ := part["text"].(string); txt != "" {
							totalText += len([]rune(txt))
						}
					case "thinking":
						s.runtime.LastThinkingPhase = "thinking"
					}
				}
				if totalText > 0 {
					s.runtime.LastPartialTextLength = totalText
				}
			}
		}

	case "user":
		// tool_result means a tool call finished
		if m, ok := msg["message"].(map[string]interface{}); ok {
			if content, ok := m["content"].([]interface{}); ok {
				for _, c := range content {
					part, ok := c.(map[string]interface{})
					if !ok {
						continue
					}
					if part["type"] == "tool_result" {
						s.runtime.ActiveTool = ""
						s.runtime.ActiveToolProgress = nil
					}
				}
			}
		}

	case "result":
		s.runtime.Processing = false
		s.runtime.Retrying = false
		s.runtime.RateLimited = false
		s.runtime.Status = ""
		s.runtime.ActiveTool = ""
		s.runtime.ActiveToolProgress = nil
		s.runtime.LastThinkingPhase = ""
		s.runtime.LastApiRetry = nil
	}
}

// waitForCompletion waits for the command to complete
func (s *Session) waitForCompletion(emitter EventEmitter) {
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
		log.Printf("[Session] Claude CLI failed with error: %s", err.Error())
	} else {
		s.Status = "completed"
	}
	s.runtime.Processing = false
	s.runtime.Retrying = false
	s.runtime.ActiveTool = ""
	s.runtime.ActiveToolProgress = nil
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
	if s.activityObserver != nil {
		s.activityObserver.CompleteSession(s.ID)
	}

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
		completeMsg := s.completionMessage()
		completeJSON, _ := json.Marshal(completeMsg)
		log.Printf("[Session] Emitting claude-complete: status=%s", s.Status)
		emitter.Emit("claude-complete", string(completeJSON))
	}
}

// watchProcessExit waits for the interactive Claude CLI process to exit
// Unlike waitForCompletion, it doesn't expect the process to end after a single response
func (s *Session) watchProcessExit(emitter EventEmitter) {
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
		log.Printf("[Session] Interactive Claude CLI exited with error: %s", err.Error())
	} else {
		s.Status = "completed"
	}
	s.runtime.Processing = false
	s.runtime.Retrying = false
	s.runtime.ActiveTool = ""
	s.runtime.ActiveToolProgress = nil
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
	if s.activityObserver != nil {
		s.activityObserver.CompleteSession(s.ID)
	}

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
		completeMsg := s.completionMessage()
		completeJSON, _ := json.Marshal(completeMsg)
		emitter.Emit("claude-complete", string(completeJSON))
	}
}

func (s *Session) completionMessage() map[string]interface{} {
	s.mu.RLock()
	runtimeCopy := s.runtime
	s.mu.RUnlock()

	return map[string]interface{}{
		"cwd":        s.Config.ProjectPath,
		"success":    s.Status == "completed",
		"status":     s.Status,
		"session_id": s.ID,
		"provider":   "claude",
		"timestamp":  time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"runtime":    runtimeCopy,
		"debug_meta": map[string]interface{}{
			"runtime_state": runtimeCopy,
		},
	}
}

// Terminate terminates the running session
func (s *Session) Terminate() error {
	s.mu.Lock()

	if s.cmd == nil || s.cmd.Process == nil {
		s.mu.Unlock()
		return fmt.Errorf("no running process")
	}

	s.cancelled = true
	cmd := s.cmd
	done := s.done
	stdin := s.stdin
	interactive := s.interactive
	s.mu.Unlock()

	// In interactive mode, close stdin first to signal the process to stop
	if interactive && stdin != nil {
		_ = stdin.Close()
	}

	return sessionproc.Terminate(cmd, done)
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

// GetClaudeSessionID returns the Claude-side session ID captured from CLI output.
// This ID can be passed as --resume to restore conversation history.
func (s *Session) GetClaudeSessionID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.claudeSessionID
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
		Runtime:     s.runtime,
	}

	if s.cmd != nil && s.cmd.Process != nil {
		status.PID = s.cmd.Process.Pid
	}

	return status
}
