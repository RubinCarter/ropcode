package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"ropcode/internal/stream"
)

type sessionEventStream struct {
	stdout    io.Writer
	stderr    io.Writer
	mu        sync.Mutex
	sessionID string
	cwd       string
	provider  string
	minSeq    int64
	useSplit  bool
	doneCh    chan error
	doneOnce  sync.Once
	closeFunc func() error
}

type splitSessionStreamConnector interface {
	ConnectSessionStream(streamID string, handler func(stream.SessionFrame)) (func() error, error)
}

func newSessionEventStream(stdout io.Writer, stderr io.Writer, sessionID string, cwd string, provider string) *sessionEventStream {
	return &sessionEventStream{
		stdout:    stdout,
		stderr:    stderr,
		sessionID: sessionID,
		cwd:       cwd,
		provider:  provider,
		doneCh:    make(chan error, 1),
	}
}

func (s *sessionEventStream) setSessionID(sessionID string) {
	s.mu.Lock()
	s.sessionID = sessionID
	s.mu.Unlock()
}

func (s *sessionEventStream) markLiveBoundary() {
	s.mu.Lock()
	s.minSeq = time.Now().UnixNano()
	s.mu.Unlock()
}

func (s *sessionEventStream) complete(err error) {
	s.doneOnce.Do(func() {
		s.doneCh <- err
	})
}

func (s *sessionEventStream) close() {
	s.mu.Lock()
	closeFunc := s.closeFunc
	s.closeFunc = nil
	s.mu.Unlock()
	if closeFunc != nil {
		_ = closeFunc()
	}
}

func (s *sessionEventStream) attachSplitStream(client rpcSession, sessionID string) {
	connector, ok := client.(splitSessionStreamConnector)
	if !ok || sessionID == "" {
		return
	}

	s.mu.Lock()
	provider := s.provider
	s.mu.Unlock()
	streamID := stream.StreamIDForSession(firstNonEmpty(provider, "claude"), sessionID)
	closeFunc, err := connector.ConnectSessionStream(streamID, s.handleSessionFrame)
	if err != nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closeFunc != nil {
		_ = closeFunc()
		return
	}
	s.useSplit = true
	s.closeFunc = closeFunc
}

func (s *sessionEventStream) handleSessionFrame(frame stream.SessionFrame) {
	s.mu.Lock()
	minSeq := s.minSeq
	s.mu.Unlock()
	if minSeq > 0 && frame.Seq <= minSeq {
		return
	}

	if frame.Kind == stream.FrameKindResult || frame.Kind == stream.FrameKindError {
		if frame.Kind == stream.FrameKindError || frame.IsError || (frame.Success != nil && !*frame.Success) {
			errText := frame.Error
			if errText == "" {
				errText = "session error"
			}
			s.complete(fmt.Errorf("%s", errText))
		} else {
			s.complete(nil)
		}
		return
	}
	if frame.Role != stream.RoleAssistant && frame.Kind != stream.FrameKindDelta && frame.Kind != stream.FrameKindMessage {
		return
	}
	lines := sessionFrameLines(frame)
	if len(lines) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, line := range lines {
		fmt.Fprintln(s.stdout, line)
	}
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
	s.mu.Lock()
	useSplit := s.useSplit
	s.mu.Unlock()
	if useSplit {
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
	s.close()
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

func subscribeSessionEvents(client rpcSession, stdout io.Writer, stderr io.Writer, sessionID string, cwd string, provider string) *sessionEventStream {
	eventStream := newSessionEventStream(stdout, stderr, sessionID, cwd, firstNonEmpty(provider, "claude"))
	eventStream.attachSplitStream(client, sessionID)
	subscribeSessionControlEvents(client, eventStream)
	return eventStream
}

func subscribeSessionControlEvents(client rpcSession, eventStream *sessionEventStream) {
	client.OnEvent("claude-error", eventStream.handleError)
	client.OnEvent("claude-complete", eventStream.handleComplete)
}

func sessionFrameLines(frame stream.SessionFrame) []string {
	var lines []string
	for _, block := range frame.Content {
		switch block.Type {
		case stream.ContentText, stream.ContentThinking:
			lines = append(lines, splitNonEmptyLines(block.Text)...)
		case stream.ContentToolResult:
			if block.Text != "" {
				lines = append(lines, splitNonEmptyLines(block.Text)...)
			}
		}
	}
	return dedupePreserveOrder(lines)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
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
