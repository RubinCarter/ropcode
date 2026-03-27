package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
)

type tuiTestRPCSession struct {
	mu       sync.Mutex
	sessions []liveProviderSession
	outputs  map[string]string
	handlers map[string][]func(payload json.RawMessage)
}

func newTUITestRPCSession(sessions []liveProviderSession, outputs map[string]string) *tuiTestRPCSession {
	clonedOutputs := make(map[string]string, len(outputs))
	for key, value := range outputs {
		clonedOutputs[key] = value
	}
	return &tuiTestRPCSession{
		sessions: append([]liveProviderSession(nil), sessions...),
		outputs:  clonedOutputs,
		handlers: make(map[string][]func(payload json.RawMessage)),
	}
}

func (s *tuiTestRPCSession) Call(method string, params []any, out any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch method {
	case "ListRunningProviderSessions":
		result, ok := out.(*[]liveProviderSession)
		if !ok {
			return errUnexpectedTUIType(method, out)
		}
		*result = append([]liveProviderSession(nil), s.sessions...)
		return nil
	case "GetProviderSessionOutput":
		result, ok := out.(*string)
		if !ok {
			return errUnexpectedTUIType(method, out)
		}
		sessionID, _ := params[0].(string)
		*result = s.outputs[sessionID]
		return nil
	default:
		return errUnexpectedTUIMethod(method)
	}
}

func (s *tuiTestRPCSession) OnEvent(eventType string, handler func(payload json.RawMessage)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[eventType] = append(s.handlers[eventType], handler)
}

func (s *tuiTestRPCSession) Close() error { return nil }

func (s *tuiTestRPCSession) setOutput(sessionID, output string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.outputs[sessionID] = output
}

func (s *tuiTestRPCSession) emit(eventType string, payload map[string]any) {
	s.mu.Lock()
	handlers := append([]func(payload json.RawMessage){}, s.handlers[eventType]...)
	s.mu.Unlock()

	data, _ := json.Marshal(payload)
	for _, handler := range handlers {
		handler(data)
	}
}

func errUnexpectedTUIMethod(method string) error {
	return &tuiTestError{text: "unexpected method: " + method}
}

func errUnexpectedTUIType(method string, out any) error {
	return &tuiTestError{text: "unexpected output type for " + method}
}

type tuiTestError struct{ text string }

func (e *tuiTestError) Error() string { return e.text }

func TestTUICommand_AttachesAndRendersLiveInstance(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	seedProjectIndex(t, inst.app.db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: inst.projectPath}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: inst.projectPath}},
		}},
	})
	if err := saveCLIContext(cfg, cliContext{
		CurrentInstanceID:    inst.server.GetInstanceID(),
		CurrentProject:       "alpha",
		CurrentProjectPath:   inst.projectPath,
		CurrentWorkspace:     "ws-a",
		CurrentWorkspacePath: inst.projectPath,
		CurrentCWD:           inst.projectPath,
	}); err != nil {
		t.Fatalf("saveCLIContext failed: %v", err)
	}

	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "hello", "sonnet", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	time.Sleep(40 * time.Millisecond)

	stdout, stderr, err := runCLI(t, "tui")
	if err != nil {
		t.Fatalf("tui failed: %v\n%s", err, stderr)
	}
	for _, want := range []string{
		"ropcode tui",
		inst.server.GetInstanceID(),
		"alpha",
		"ws-a",
		inst.projectPath,
		sessionID,
		"hello",
		"assistant reply",
	} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("expected %q in output, got %q", want, stdout)
		}
	}
}

func TestTUIRefreshSelectsSessionFromCLIContext(t *testing.T) {
	sessionA := liveProviderSession{
		SessionID:   "session-a",
		ProjectPath: "/tmp/project",
		Provider:    "claude",
		Status:      "running",
		Model:       "sonnet",
		StartedAt:   time.Unix(200, 0),
	}
	sessionB := liveProviderSession{
		SessionID:   "session-b",
		ProjectPath: "/tmp/project",
		Provider:    "claude",
		Status:      "running",
		Model:       "sonnet",
		StartedAt:   time.Unix(100, 0),
	}
	client := newTUITestRPCSession([]liveProviderSession{sessionA, sessionB}, map[string]string{
		"session-a": "output-a\n",
		"session-b": "output-b\n",
	})

	var stdout bytes.Buffer
	view := newTUIView(tuiViewOptions{
		writer:            &stdout,
		client:            client,
		instanceID:        "inst-1",
		instanceSource:    "saved",
		wsURL:             "ws://127.0.0.1:9999/ws",
		contextSummary:    tuiContextSummary{ProjectName: "alpha", WorkspaceName: "ws-a", CWD: "/tmp/project"},
		selectedSessionID: "session-b",
	})

	if err := view.Refresh(); err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	output := stdout.String()
	if !strings.Contains(output, "id: session-b") {
		t.Fatalf("expected selected session-b, got %q", output)
	}
	if !strings.Contains(output, "output-b") {
		t.Fatalf("expected selected session output, got %q", output)
	}
}
