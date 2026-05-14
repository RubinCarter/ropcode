package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"
)

type liveProviderSession struct {
	SessionID   string    `json:"session_id"`
	ProjectPath string    `json:"project_path"`
	Model       string    `json:"model"`
	Status      string    `json:"status"`
	StartedAt   time.Time `json:"started_at"`
	PID         int       `json:"pid,omitempty"`
	Provider    string    `json:"provider"`
}

type sessionCommandOptions struct {
	cwd           string
	provider      string
	prompt        string
	model         string
	providerAPIID string
	sessionID     string
	follow        bool
	fresh         bool
	wait          bool
}

type sessionEventStream struct {
	stdout    io.Writer
	stderr    io.Writer
	mu        sync.Mutex
	sessionID string
	cwd       string
	doneCh    chan error
	doneOnce  sync.Once
}

func newSessionEventStream(stdout io.Writer, stderr io.Writer, sessionID string, cwd string) *sessionEventStream {
	return &sessionEventStream{
		stdout:    stdout,
		stderr:    stderr,
		sessionID: sessionID,
		cwd:       cwd,
		doneCh:    make(chan error, 1),
	}
}

func (s *sessionEventStream) setSessionID(sessionID string) {
	s.mu.Lock()
	s.sessionID = sessionID
	s.mu.Unlock()
}

func (s *sessionEventStream) complete(err error) {
	s.doneOnce.Do(func() {
		s.doneCh <- err
	})
}

func (s *sessionEventStream) handleOutput(payload json.RawMessage) {
	if !s.eventMatches(payload) {
		return
	}
	decoded, ok := decodePayloadValue(payload)
	if !ok {
		return
	}
	m, isMap := decoded.(map[string]interface{})
	if !isMap {
		return
	}
	msgType, _ := m["type"].(string)
	// In interactive mode, claude-complete is never fired per-turn.
	// The "result" message in claude-output signals turn completion.
	if msgType == "result" {
		subtype, _ := m["subtype"].(string)
		if subtype == "error" {
			errText, _ := m["error"].(string)
			if errText == "" {
				errText = "session error"
			}
			s.complete(fmt.Errorf("%s", errText))
		} else {
			s.complete(nil)
		}
		return
	}
	// Only print assistant messages; ignore system, user, result, etc.
	if msgType != "assistant" {
		return
	}
	lines := extractPayloadLines(payload)
	if len(lines) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, line := range lines {
		fmt.Fprintln(s.stdout, line)
	}
}

func (s *sessionEventStream) handleError(payload json.RawMessage) {
	if !s.eventMatches(payload) {
		return
	}
	lines := extractPayloadLines(payload)
	if len(lines) == 0 {
		lines = []string{"session failed"}
	}
	s.mu.Lock()
	for _, line := range lines {
		fmt.Fprintln(s.stderr, line)
	}
	s.mu.Unlock()
	// Don't complete here: the session may retry and succeed.
	// handleComplete will signal done with the final status.
}

func (s *sessionEventStream) handleComplete(payload json.RawMessage) {
	if !s.eventMatches(payload) {
		return
	}
	decoded, _ := decodePayloadValue(payload)
	if m, ok := decoded.(map[string]interface{}); ok {
		if success, _ := m["success"].(bool); !success {
			if status, _ := m["status"].(string); status != "" && status != "completed" {
				s.complete(fmt.Errorf("session %s", status))
				return
			}
		}
	}
	s.complete(nil)
}

func (s *sessionEventStream) wait() error {
	err := <-s.doneCh
	time.Sleep(50 * time.Millisecond)
	return err
}

func runRuntimeWorkspaceCommand(state cliState, args []string) error {
	if len(args) == 0 {
		writeSessionUsage(state.stderr)
		return errors.New("session subcommand required")
	}
	if isHelpArg(args[0]) {
		writeSessionUsage(state.stdout)
		return nil
	}

	var opts sessionCommandOptions
	switch args[0] {
	case "send":
		parsed, err := parseSessionSendArgs(args[1:], state.cwdFlag)
		if err != nil {
			return err
		}
		opts = parsed
	case "status", "list":
		parsed, err := parseSessionListArgs(args[1:], state.cwdFlag)
		if err != nil {
			return err
		}
		opts = parsed
	case "logs":
		parsed, err := parseSessionLogsArgs(args[1:], state.cwdFlag)
		if err != nil {
			return err
		}
		opts = parsed
	case "stop":
		parsed, err := parseSessionStopArgs(args[1:], state.cwdFlag)
		if err != nil {
			return err
		}
		opts = parsed
	default:
		return fmt.Errorf("unknown workspace subcommand %q", strings.Join(args, " "))
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	record, _, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return err
	}

	client, err := state.deps.dialRPC(instanceWSURL(record), record.AuthKey)
	if err != nil {
		return fmt.Errorf("attach to instance %s: %w", record.ID, err)
	}
	defer client.Close()

	switch args[0] {
	case "send":
		return runSessionSend(state, client, opts)
	case "status":
		return runWorkspaceStatus(state, client, opts)
	case "list":
		return runSessionList(state, client, opts)
	case "logs":
		return runSessionLogs(state, client, opts)
	case "stop":
		return runSessionStop(state, client, opts)
	default:
		return fmt.Errorf("unknown workspace subcommand %q", strings.Join(args, " "))
	}
}

func writeSessionUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode workspace send --cwd <path> --prompt <text> [--provider <name>] [--model <model>] [--fresh] [--wait]")
	fmt.Fprintln(w, "  ropcode workspace status [--cwd <path>] [--provider <name>]")
	fmt.Fprintln(w, "  ropcode workspace list [--cwd <path>] [--provider <name>]")
	fmt.Fprintln(w, "  ropcode workspace logs --cwd <path> [--follow]")
	fmt.Fprintln(w, "  ropcode workspace stop --cwd <path>")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Flags:")
	fmt.Fprintln(w, "  --cwd <path>       Workspace directory path (identifies which workspace to act on)")
	fmt.Fprintln(w, "  --prompt <text>    Message to send to the AI")
	fmt.Fprintln(w, "  --provider <name>  AI provider: claude (default), gemini, codex")
	fmt.Fprintln(w, "  --model <model>    Model name override (optional, uses provider default)")
	fmt.Fprintln(w, "  --fresh            Stop any running session in this workspace and start a new one")
	fmt.Fprintln(w, "  --wait             Block until the AI finishes and print the full response")
	fmt.Fprintln(w, "  --follow           Stream logs in real time (for logs subcommand)")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Notes:")
	fmt.Fprintln(w, "  'send' automatically continues an existing running session in the workspace,")
	fmt.Fprintln(w, "  or starts a new session if none is running. Use --fresh to force a new session.")
	fmt.Fprintln(w, "  'status' shows running sessions; prints 'idle' if none are active.")
}

func runSessionSend(state cliState, client rpcSession, opts sessionCommandOptions) error {
	// Use the interactive session API: reuses existing session for the workspace,
	// or starts a new one if none exists. --fresh terminates any existing session first.
	resumeSessionID := ""
	if opts.fresh {
		resumeSessionID = "__ROP_FRESH_SESSION__"
	}

	var stream *sessionEventStream
	if opts.wait {
		stream = subscribeSessionEvents(client, state.stdout, state.stderr, "", opts.cwd)
	}

	// Start or reuse interactive session
	var sessionID string
	if err := client.Call("StartInteractiveClaudeSession", []any{opts.cwd, opts.model, opts.providerAPIID, resumeSessionID}, &sessionID); err != nil {
		return fmt.Errorf("start interactive session: %w", err)
	}

	// Send the message to the interactive session
	if err := client.Call("SendClaudeMessage", []any{opts.cwd, sessionID, opts.prompt}, nil); err != nil {
		return fmt.Errorf("send message: %w", err)
	}

	if !opts.wait {
		fmt.Fprintln(state.stdout, "ok")
		return nil
	}
	stream.setSessionID(sessionID)
	if err := stream.wait(); err != nil {
		return err
	}
	return nil
}

func runSessionList(state cliState, client rpcSession, opts sessionCommandOptions) error {
	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return err
	}

	filtered := make([]liveProviderSession, 0, len(sessions))
	for _, session := range sessions {
		if opts.provider != "" && session.Provider != opts.provider {
			continue
		}
		if opts.cwd != "" && session.ProjectPath != opts.cwd {
			continue
		}
		filtered = append(filtered, session)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].StartedAt.After(filtered[j].StartedAt)
	})

	if len(filtered) == 0 {
		fmt.Fprintln(state.stdout, "no running sessions found")
		return nil
	}

	fmt.Fprintln(state.stdout, "SESSION\tPROVIDER\tSTATUS\tCWD\tMODEL")
	for _, session := range filtered {
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\t%s\n", session.SessionID, session.Provider, session.Status, session.ProjectPath, session.Model)
	}
	return nil
}

func runSessionLogs(state cliState, client rpcSession, opts sessionCommandOptions) error {
	if opts.sessionID == "" && opts.cwd != "" {
		var sessions []liveProviderSession
		if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
			return err
		}
		sort.Slice(sessions, func(i, j int) bool {
			return sessions[i].StartedAt.After(sessions[j].StartedAt)
		})
		for _, s := range sessions {
			if s.ProjectPath == opts.cwd {
				opts.sessionID = s.SessionID
				break
			}
		}
		if opts.sessionID == "" {
			return fmt.Errorf("no running session found for --cwd %s", opts.cwd)
		}
	}
	stream := subscribeSessionEvents(client, state.stdout, state.stderr, opts.sessionID, opts.cwd)

	var output string
	if err := client.Call("GetProviderSessionOutput", []any{opts.sessionID}, &output); err != nil {
		return err
	}
	renderOutputBuffer(state.stdout, output)
	if !opts.follow {
		return nil
	}

	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return err
	}
	for _, session := range sessions {
		if session.SessionID == opts.sessionID {
			return stream.wait()
		}
	}

	var latest string
	if err := client.Call("GetProviderSessionOutput", []any{opts.sessionID}, &latest); err != nil {
		return err
	}
	if latest != output {
		renderOutputBuffer(state.stdout, strings.TrimPrefix(latest, output))
	}
	return nil
}

func subscribeSessionEvents(client rpcSession, stdout io.Writer, stderr io.Writer, sessionID string, cwd string) *sessionEventStream {
	stream := newSessionEventStream(stdout, stderr, sessionID, cwd)
	client.OnEvent("claude-output", stream.handleOutput)
	client.OnEvent("claude-error", stream.handleError)
	client.OnEvent("claude-complete", stream.handleComplete)
	return stream
}

func runWorkspaceStatus(state cliState, client rpcSession, opts sessionCommandOptions) error {
	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return err
	}
	var filtered []liveProviderSession
	for _, s := range sessions {
		if opts.cwd != "" && s.ProjectPath != opts.cwd {
			continue
		}
		if opts.provider != "" && s.Provider != opts.provider {
			continue
		}
		filtered = append(filtered, s)
	}
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].StartedAt.After(filtered[j].StartedAt)
	})
	if len(filtered) == 0 {
		fmt.Fprintln(state.stdout, "idle")
		return nil
	}
	fmt.Fprintln(state.stdout, "SESSION\tPROVIDER\tSTATUS\tCWD\tMODEL")
	for _, s := range filtered {
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\t%s\n", s.SessionID, s.Provider, s.Status, s.ProjectPath, s.Model)
	}
	return nil
}

func runSessionStop(state cliState, client rpcSession, opts sessionCommandOptions) error {
	if opts.sessionID == "" && opts.cwd != "" {
		var sessions []liveProviderSession
		if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
			return err
		}
		sort.Slice(sessions, func(i, j int) bool {
			return sessions[i].StartedAt.After(sessions[j].StartedAt)
		})
		for _, s := range sessions {
			if s.ProjectPath == opts.cwd {
				opts.sessionID = s.SessionID
				break
			}
		}
		if opts.sessionID == "" {
			return fmt.Errorf("no running session found for --cwd %s", opts.cwd)
		}
	}
	if err := client.Call("StopProviderSession", []any{opts.sessionID}, nil); err != nil {
		return err
	}
	fmt.Fprintf(state.stdout, "stopped\t%s\n", opts.sessionID)
	return nil
}

func parseSessionSendArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	if opts.provider == "" {
		opts.provider = "claude"
	}
	if opts.cwd == "" || opts.prompt == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode workspace send --cwd <path> --prompt <text> [--provider <provider>] [--fresh]")
	}
	return opts, nil
}

func parseSessionListArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	return opts, nil
}

func parseSessionLogsArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	if opts.sessionID == "" && opts.cwd == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode runtime session logs --session <id> [--follow] | --cwd <path> [--follow]")
	}
	return opts, nil
}

func parseSessionStopArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	if opts.sessionID == "" && opts.cwd == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode runtime session stop --session <id> | --cwd <path>")
	}
	return opts, nil
}

func parseSessionFlagPairs(args []string) (sessionCommandOptions, error) {
	var opts sessionCommandOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--cwd":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.cwd = value
			i = next
		case "--provider":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.provider = value
			i = next
		case "--prompt":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.prompt = value
			i = next
		case "--model":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.model = value
			i = next
		case "--provider-api-id":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.providerAPIID = value
			i = next
		case "--session":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.sessionID = value
			i = next
		case "--follow":
			opts.follow = true
		case "--fresh":
			opts.fresh = true
		case "--wait":
			opts.wait = true
		default:
			return sessionCommandOptions{}, fmt.Errorf("unknown flag %q", args[i])
		}
	}
	return opts, nil
}

func requireFlagValue(args []string, index int) (string, int, error) {
	if index+1 >= len(args) {
		return "", index, fmt.Errorf("%s requires a value", args[index])
	}
	return args[index+1], index + 1, nil
}

func renderOutputBuffer(w io.Writer, output string) {
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// Only render assistant messages from JSONL output
		var msg map[string]json.RawMessage
		if err := json.Unmarshal([]byte(trimmed), &msg); err == nil {
			var msgType string
			_ = json.Unmarshal(msg["type"], &msgType)
			if msgType != "assistant" {
				continue
			}
		}
		for _, rendered := range extractStringLines(trimmed) {
			fmt.Fprintln(w, rendered)
		}
	}
}

func (s *sessionEventStream) eventMatches(payload json.RawMessage) bool {
	s.mu.Lock()
	sessionID := s.sessionID
	cwd := s.cwd
	s.mu.Unlock()
	decoded, ok := decodePayloadValue(payload)
	if !ok {
		return false
	}
	if sessionID != "" && payloadSessionID(decoded) == sessionID {
		return true
	}
	if cwd != "" && payloadCWD(decoded) == cwd {
		return true
	}
	return false
}

func extractPayloadLines(payload json.RawMessage) []string {
	decoded, ok := decodePayloadValue(payload)
	if !ok {
		return nil
	}
	return payloadLines(decoded)
}

func decodePayloadValue(raw []byte) (interface{}, bool) {
	var decoded interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return string(raw), true
	}
	return normalizePayloadValue(decoded)
}

func normalizePayloadValue(value interface{}) (interface{}, bool) {
	if str, ok := value.(string); ok {
		trimmed := strings.TrimSpace(str)
		if trimmed != "" && (strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "\"")) {
			var nested interface{}
			if err := json.Unmarshal([]byte(trimmed), &nested); err == nil {
				return normalizePayloadValue(nested)
			}
		}
		return str, true
	}
	return value, true
}

func payloadCWD(value interface{}) string {
	if m, ok := value.(map[string]interface{}); ok {
		if cwd, ok := m["cwd"].(string); ok {
			return cwd
		}
	}
	return ""
}

func payloadSessionID(value interface{}) string {
	switch v := value.(type) {
	case map[string]interface{}:
		if sessionID, ok := v["session_id"].(string); ok {
			return sessionID
		}
		for _, key := range []string{"output", "result", "error", "message"} {
			if nested, ok := v[key]; ok {
				if sessionID := payloadSessionID(nested); sessionID != "" {
					return sessionID
				}
			}
		}
	case []interface{}:
		for _, item := range v {
			if sessionID := payloadSessionID(item); sessionID != "" {
				return sessionID
			}
		}
	case string:
		if nested, ok := normalizePayloadValue(v); ok && nested != v {
			return payloadSessionID(nested)
		}
	}
	return ""
}

func payloadLines(value interface{}) []string {
	switch v := value.(type) {
	case string:
		return extractStringLines(v)
	case map[string]interface{}:
		var lines []string
		if message, ok := v["message"].(map[string]interface{}); ok {
			if content, ok := message["content"].([]interface{}); ok {
				for _, item := range content {
					if msg, ok := item.(map[string]interface{}); ok {
						if text, ok := msg["text"].(string); ok {
							lines = append(lines, splitNonEmptyLines(text)...)
						}
					}
				}
			}
		}
		for _, key := range []string{"output", "error", "result", "content", "text"} {
			if nested, ok := v[key]; ok {
				lines = append(lines, payloadLines(nested)...)
			}
		}
		return dedupePreserveOrder(lines)
	case []interface{}:
		var lines []string
		for _, item := range v {
			lines = append(lines, payloadLines(item)...)
		}
		return dedupePreserveOrder(lines)
	default:
		return nil
	}
}

func extractStringLines(value string) []string {
	if nested, ok := normalizePayloadValue(value); ok {
		if nestedString, same := nested.(string); !same || nestedString != value {
			return payloadLines(nested)
		}
	}
	return splitNonEmptyLines(value)
}

func splitNonEmptyLines(value string) []string {
	parts := strings.Split(value, "\n")
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		lines = append(lines, trimmed)
	}
	return lines
}

func dedupePreserveOrder(lines []string) []string {
	seen := make(map[string]struct{}, len(lines))
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if line == "" {
			continue
		}
		if _, ok := seen[line]; ok {
			continue
		}
		seen[line] = struct{}{}
		result = append(result, line)
	}
	return result
}
