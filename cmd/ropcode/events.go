package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

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
	// handleComplete signals done with the final status; the session may still retry.
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

func subscribeSessionEvents(client rpcSession, stdout io.Writer, stderr io.Writer, sessionID string, cwd string) *sessionEventStream {
	stream := newSessionEventStream(stdout, stderr, sessionID, cwd)
	client.OnEvent("claude-output", stream.handleOutput)
	client.OnEvent("claude-error", stream.handleError)
	client.OnEvent("claude-complete", stream.handleComplete)
	return stream
}

func renderOutputBuffer(w io.Writer, output string) {
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
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
