// internal/codex/session.go
package codex

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

// Start starts the Codex session
func (s *Session) Start(ctx context.Context, binaryPath string, emitter EventEmitter) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == "running" {
		return fmt.Errorf("session already running")
	}

	// Build command arguments for Codex CLI
	// Codex uses 'exec' subcommand for non-interactive execution
	args := []string{
		"exec",
		"--sandbox", "workspace-write",
	}

	// Set approval policy to never (no user interaction)
	args = append(args, "-c", "approval_policy=\"never\"")

	// Enable network access for commands like pip, npm, curl, wget, etc.
	args = append(args, "-c", "sandbox_workspace_write.network_access=true")

	// Add model parameter
	if s.Config.Model != "" {
		args = append(args, "-m", s.Config.Model)
	}

	// Set working directory
	if s.Config.ProjectPath != "" {
		args = append(args, "-C", s.Config.ProjectPath)
	}

	// Enable JSON output (JSONL format)
	args = append(args, "--json")

	// Disable color output to avoid ANSI codes in JSON
	args = append(args, "--color", "never")

	// Add prompt as the last argument with separator
	args = append(args, "--")
	args = append(args, s.Config.Prompt)

	log.Printf("[Codex Session] Starting Codex with args: %v", args)

	// Create command
	s.cmd = exec.CommandContext(ctx, binaryPath, args...)

	// Set working directory to project path
	if s.Config.ProjectPath != "" {
		s.cmd.Dir = s.Config.ProjectPath
	}

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
			// Transform Codex output to unified format
			unified := s.transformToUnified(line)
			if unified != "" {
				log.Printf("[Codex Session] Emitting claude-output (%s)", outputType)
				emitter.Emit("claude-output", unified)
			}
		}
	}
}

// transformToUnified transforms Codex JSONL output to unified Claude format
func (s *Session) transformToUnified(line string) string {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(line), &parsed); err != nil {
		// If not valid JSON, wrap as text message
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "codex",
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
	log.Printf("[Codex Session] Transforming event type: %s", eventType)

	switch eventType {
	case "thread.started":
		// Session start
		threadID, _ := parsed["thread_id"].(string)
		if threadID != "" {
			s.ID = threadID
		}
		unified := map[string]interface{}{
			"cwd":        s.Config.ProjectPath,
			"provider":   "codex",
			"type":       "system",
			"subtype":    "init",
			"session_id": threadID,
		}
		result, _ := json.Marshal(unified)
		return string(result)

	case "response_item":
		// Response item - check payload type
		payload, ok := parsed["payload"].(map[string]interface{})
		if !ok {
			return ""
		}

		payloadType, _ := payload["type"].(string)
		role, _ := payload["role"].(string)

		switch payloadType {
		case "message":
			// Text message from assistant
			content := s.extractTextContent(payload)
			if content == "" {
				return ""
			}

			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "assistant",
				"message": map[string]interface{}{
					"role": role,
					"content": []map[string]interface{}{
						{"type": "text", "text": content},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)

		case "function_call":
			// Tool call
			callID, _ := payload["call_id"].(string)
			name, _ := payload["name"].(string)
			arguments, _ := payload["arguments"].(string)

			var argsValue map[string]interface{}
			if err := json.Unmarshal([]byte(arguments), &argsValue); err != nil {
				argsValue = map[string]interface{}{}
			}

			// Use the same tool adaptation logic as history loading
			toolName, toolInput := adaptCodexToolToClaude(name, argsValue)

			toolUseContent := map[string]interface{}{
				"type":  "tool_use",
				"id":    callID,
				"name":  toolName,
				"input": toolInput,
			}
			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "assistant",
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": []map[string]interface{}{toolUseContent},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)

		case "function_call_output":
			// Tool result
			callID, _ := payload["call_id"].(string)
			output, _ := payload["output"].(string)

			// Try to parse output as JSON to get the actual output
			var outputParsed map[string]interface{}
			if err := json.Unmarshal([]byte(output), &outputParsed); err == nil {
				if actualOutput, ok := outputParsed["output"].(string); ok {
					output = actualOutput
				}
			}

			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "user",
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{
							"type":        "tool_result",
							"tool_use_id": callID,
							"content":     output,
						},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)

		case "custom_tool_call":
			// Custom tool call (like apply_patch)
			callID, _ := payload["call_id"].(string)
			name, _ := payload["name"].(string)
			input, _ := payload["input"].(string)

			// Use the same tool adaptation logic
			argsValue := map[string]interface{}{"input": input}
			toolName, toolInput := adaptCodexToolToClaude(name, argsValue)

			toolUseContent := map[string]interface{}{
				"type":  "tool_use",
				"id":    callID,
				"name":  toolName,
				"input": toolInput,
			}
			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "assistant",
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": []map[string]interface{}{toolUseContent},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)

		case "custom_tool_call_output":
			// Custom tool result
			callID, _ := payload["call_id"].(string)
			output, _ := payload["output"].(string)

			// Try to parse output as JSON
			var outputParsed map[string]interface{}
			if err := json.Unmarshal([]byte(output), &outputParsed); err == nil {
				if actualOutput, ok := outputParsed["output"].(string); ok {
					output = actualOutput
				}
			}

			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "user",
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{
							"type":        "tool_result",
							"tool_use_id": callID,
							"content":     output,
						},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)
		}

	case "item.completed":
		// Item completed - extract text content from item
		item, ok := parsed["item"].(map[string]interface{})
		if !ok {
			return ""
		}

		// Get item type (could be "type" or "item_type")
		itemType, _ := item["type"].(string)
		if itemType == "" {
			itemType, _ = item["item_type"].(string)
		}

		text, _ := item["text"].(string)
		if text == "" {
			return ""
		}

		// Handle different item types
		switch itemType {
		case "agent_message", "reasoning", "assistant_message":
			unified := map[string]interface{}{
				"cwd":      s.Config.ProjectPath,
				"provider": "codex",
				"type":     "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "text", "text": text},
					},
				},
			}
			result, _ := json.Marshal(unified)
			return string(result)
		default:
			// For other types, still show as assistant message
			if text != "" {
				unified := map[string]interface{}{
					"cwd":      s.Config.ProjectPath,
					"provider": "codex",
					"type":     "assistant",
					"message": map[string]interface{}{
						"role": "assistant",
						"content": []map[string]interface{}{
							{"type": "text", "text": text},
						},
					},
				}
				result, _ := json.Marshal(unified)
				return string(result)
			}
		}
		return ""

	case "turn.completed":
		// Turn completed - result message
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "codex",
			"type":     "result",
			"result":   "Execution completed successfully",
			"usage":    parsed["usage"],
		}
		result, _ := json.Marshal(unified)
		return string(result)

	case "turn.started", "item.started", "session_meta", "turn_context",
		"response.created", "response.in_progress", "response.completed",
		"response.output_item.added", "agent_reasoning_section_break":
		// Silently ignore metadata events
		return ""

	case "thread.completed", "thread.cancelled", "thread.error":
		// Session completion
		success := eventType == "thread.completed"
		unified := map[string]interface{}{
			"cwd":      s.Config.ProjectPath,
			"provider": "codex",
			"type":     "result",
			"subtype":  "session_complete",
			"success":  success,
		}
		result, _ := json.Marshal(unified)
		return string(result)
	}

	// Default: pass through with provider info
	parsed["cwd"] = s.Config.ProjectPath
	parsed["provider"] = "codex"
	result, _ := json.Marshal(parsed)
	return string(result)
}

// extractTextContent extracts text content from a message payload
func (s *Session) extractTextContent(payload map[string]interface{}) string {
	content, ok := payload["content"].([]interface{})
	if !ok {
		return ""
	}

	var texts []string
	for _, item := range content {
		if itemMap, ok := item.(map[string]interface{}); ok {
			if itemType, _ := itemMap["type"].(string); itemType == "text" || itemType == "output_text" {
				if text, ok := itemMap["text"].(string); ok {
					texts = append(texts, text)
				}
			}
		}
	}

	if len(texts) > 0 {
		return texts[0] // Return first text content
	}
	return ""
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
		log.Printf("[Codex Session] Emitting claude-complete: status=%s", s.Status)
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
