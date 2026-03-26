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
}

type sessionEventStream struct {
	stdout    io.Writer
	stderr    io.Writer
	mu        sync.Mutex
	sessionID string
	doneCh    chan error
	doneOnce  sync.Once
}

func newSessionEventStream(stdout io.Writer, stderr io.Writer, sessionID string) *sessionEventStream {
	return &sessionEventStream{
		stdout:    stdout,
		stderr:    stderr,
		sessionID: sessionID,
		doneCh:    make(chan error, 1),
	}
}

func (s *sessionEventStream) setSessionID(sessionID string) {
	s.mu.Lock()
	s.sessionID = sessionID
	s.mu.Unlock()
}

func (s *sessionEventStream) currentSessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessionID
}

func (s *sessionEventStream) complete(err error) {
	s.doneOnce.Do(func() {
		s.doneCh <- err
	})
}

func (s *sessionEventStream) handleOutput(payload json.RawMessage) {
	if !sessionEventMatches(payload, s.currentSessionID()) {
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
	if !sessionEventMatches(payload, s.currentSessionID()) {
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
	s.complete(errors.New(strings.Join(lines, "\n")))
}

func (s *sessionEventStream) handleComplete(payload json.RawMessage) {
	if !sessionEventMatches(payload, s.currentSessionID()) {
		return
	}
	s.complete(nil)
}

func (s *sessionEventStream) wait() error {
	err := <-s.doneCh
	time.Sleep(50 * time.Millisecond)
	return err
}

func runSessionCommand(state cliState, args []string) error {
	if len(args) == 0 {
		return errors.New("session subcommand required")
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
	case "start":
		opts, err := parseSessionStartArgs(args[1:])
		if err != nil {
			return err
		}
		return runSessionStart(state, client, opts)
	case "send":
		opts, err := parseSessionSendArgs(args[1:])
		if err != nil {
			return err
		}
		return runSessionSend(state, client, opts)
	case "list":
		opts, err := parseSessionListArgs(args[1:])
		if err != nil {
			return err
		}
		return runSessionList(state, client, opts)
	case "logs":
		opts, err := parseSessionLogsArgs(args[1:])
		if err != nil {
			return err
		}
		return runSessionLogs(state, client, opts)
	case "stop":
		opts, err := parseSessionStopArgs(args[1:])
		if err != nil {
			return err
		}
		return runSessionStop(state, client, opts)
	default:
		return fmt.Errorf("unknown session subcommand %q", strings.Join(args, " "))
	}
}

func runSessionStart(state cliState, client rpcSession, opts sessionCommandOptions) error {
	stream := subscribeSessionEvents(client, state.stdout, state.stderr, "")
	var sessionID string
	if err := client.Call("StartProviderSession", []any{opts.provider, opts.cwd, opts.prompt, opts.model, opts.providerAPIID}, &sessionID); err != nil {
		return err
	}
	stream.setSessionID(sessionID)
	fmt.Fprintf(state.stdout, "session\t%s\n", sessionID)
	return stream.wait()
}

func runSessionSend(state cliState, client rpcSession, opts sessionCommandOptions) error {
	stream := subscribeSessionEvents(client, state.stdout, state.stderr, opts.sessionID)
	var sessionID string
	if err := client.Call("SendProviderSessionMessage", []any{opts.provider, opts.cwd, opts.sessionID, opts.prompt}, &sessionID); err != nil {
		return err
	}
	stream.setSessionID(sessionID)
	fmt.Fprintf(state.stdout, "session\t%s\n", sessionID)
	return stream.wait()
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
	var output string
	if err := client.Call("GetProviderSessionOutput", []any{opts.sessionID}, &output); err != nil {
		return err
	}
	renderOutputBuffer(state.stdout, output)
	if !opts.follow {
		return nil
	}
	stream := subscribeSessionEvents(client, state.stdout, state.stderr, opts.sessionID)
	return stream.wait()
}

func runSessionStop(state cliState, client rpcSession, opts sessionCommandOptions) error {
	if err := client.Call("StopProviderSession", []any{opts.sessionID}, nil); err != nil {
		return err
	}
	fmt.Fprintf(state.stdout, "stopped\t%s\n", opts.sessionID)
	return nil
}

func subscribeSessionEvents(client rpcSession, stdout io.Writer, stderr io.Writer, sessionID string) *sessionEventStream {
	stream := newSessionEventStream(stdout, stderr, sessionID)
	client.OnEvent("claude-output", stream.handleOutput)
	client.OnEvent("claude-error", stream.handleError)
	client.OnEvent("claude-complete", stream.handleComplete)
	return stream
}

func parseSessionStartArgs(args []string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" || opts.provider == "" || opts.prompt == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode session start --cwd <path> --provider <provider> --prompt <text> [--model <model>] [--provider-api-id <id>]")
	}
	return opts, nil
}

func parseSessionSendArgs(args []string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.sessionID == "" || opts.cwd == "" || opts.provider == "" || opts.prompt == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode session send --session <id> --cwd <path> --provider <provider> --prompt <text>")
	}
	return opts, nil
}

func parseSessionListArgs(args []string) (sessionCommandOptions, error) {
	return parseSessionFlagPairs(args)
}

func parseSessionLogsArgs(args []string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.sessionID == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode session logs --session <id> [--follow]")
	}
	return opts, nil
}

func parseSessionStopArgs(args []string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.sessionID == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode session stop --session <id>")
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
		for _, rendered := range extractStringLines(trimmed) {
			fmt.Fprintln(w, rendered)
		}
	}
}

func sessionEventMatches(payload json.RawMessage, sessionID string) bool {
	if sessionID == "" {
		return false
	}
	decoded, ok := decodePayloadValue(payload)
	if !ok {
		return false
	}
	return payloadSessionID(decoded) == sessionID
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
