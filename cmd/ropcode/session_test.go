package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/websocket"
)

type rpcLiveSession struct {
	SessionID   string    `json:"session_id"`
	ProjectPath string    `json:"project_path"`
	Model       string    `json:"model"`
	Status      string    `json:"status"`
	StartedAt   time.Time `json:"started_at"`
	PID         int       `json:"pid,omitempty"`
	Provider    string    `json:"provider"`
	Output      string    `json:"-"`
}

type sessionSendCall struct {
	Provider    string
	SessionID   string
	ProjectPath string
	Prompt      string
}

type sessionRPCTestApp struct {
	db          *database.Database
	mu          sync.Mutex
	sessions    map[string]*rpcLiveSession
	sends       []sessionSendCall
	broadcaster func(string, interface{})
	nextID      int
}

func newSessionRPCTestApp(db *database.Database) *sessionRPCTestApp {
	return &sessionRPCTestApp{
		db:       db,
		sessions: make(map[string]*rpcLiveSession),
	}
}

func (a *sessionRPCTestApp) Database() *database.Database {
	return a.db
}

func (a *sessionRPCTestApp) StartProviderSession(provider, projectPath, prompt, model, providerApiID string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.nextID++
	sessionID := fmt.Sprintf("%s-session-%d", provider, a.nextID)
	a.sessions[sessionID] = &rpcLiveSession{
		SessionID:   sessionID,
		ProjectPath: projectPath,
		Model:       model,
		Status:      "running",
		StartedAt:   time.Now().UTC(),
		Provider:    provider,
		Output:      prompt + "\nassistant reply\n",
	}

	go func() {
		time.Sleep(20 * time.Millisecond)
		a.emitOutput(sessionID, projectPath, provider, prompt)
		a.emitOutput(sessionID, projectPath, provider, "assistant reply")
		a.emitComplete(sessionID, projectPath, provider)
	}()

	return sessionID, nil
}

func (a *sessionRPCTestApp) SendProviderSessionMessage(provider, projectPath, sessionID, prompt string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	session, ok := a.sessions[sessionID]
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	a.sends = append(a.sends, sessionSendCall{Provider: provider, SessionID: sessionID, ProjectPath: projectPath, Prompt: prompt})
	session.Output += prompt + "\nassistant follow-up\n"

	go func() {
		time.Sleep(20 * time.Millisecond)
		a.emitOutput(sessionID, projectPath, provider, prompt)
		a.emitOutput(sessionID, projectPath, provider, "assistant follow-up")
		a.emitComplete(sessionID, projectPath, provider)
	}()

	return sessionID, nil
}

func (a *sessionRPCTestApp) ListRunningProviderSessions() []rpcLiveSession {
	a.mu.Lock()
	defer a.mu.Unlock()

	result := make([]rpcLiveSession, 0, len(a.sessions))
	for _, session := range a.sessions {
		if session.Status == "running" {
			result = append(result, *session)
		}
	}
	return result
}

func (a *sessionRPCTestApp) GetProviderSessionOutput(sessionID string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	session, ok := a.sessions[sessionID]
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	return session.Output, nil
}

func (a *sessionRPCTestApp) StopProviderSession(sessionID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	session, ok := a.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	session.Status = "cancelled"
	go func() {
		time.Sleep(20 * time.Millisecond)
		a.emitComplete(sessionID, session.ProjectPath, session.Provider)
	}()
	return nil
}

func (a *sessionRPCTestApp) emitOutput(sessionID, cwd, provider, text string) {
	payload, _ := json.Marshal(map[string]any{
		"type":       "assistant",
		"session_id": sessionID,
		"cwd":        cwd,
		"provider":   provider,
		"message": map[string]any{
			"role": "assistant",
			"content": []map[string]any{{
				"type": "text",
				"text": text,
			}},
		},
	})
	if a.broadcaster != nil {
		a.broadcaster("claude-output", string(payload))
	}
}

func (a *sessionRPCTestApp) emitComplete(sessionID, cwd, provider string) {
	payload, _ := json.Marshal(map[string]any{
		"session_id": sessionID,
		"cwd":        cwd,
		"provider":   provider,
		"status":     "completed",
	})
	if a.broadcaster != nil {
		a.broadcaster("claude-complete", string(payload))
	}
}

func (a *sessionRPCTestApp) completeSession(sessionID string) {
	a.mu.Lock()
	session, ok := a.sessions[sessionID]
	if ok {
		session.Status = "completed"
	}
	a.mu.Unlock()
	if ok {
		a.emitComplete(sessionID, session.ProjectPath, session.Provider)
	}
}

type registeredSessionInstance struct {
	app         *sessionRPCTestApp
	server      *websocket.Server
	projectPath string
}

func startRegisteredSessionInstance(t *testing.T) *registeredSessionInstance {
	t.Helper()

	_, db := setupCLITestDB(t)
	app := newSessionRPCTestApp(db)
	server := websocket.NewServer(app)
	app.broadcaster = server.BroadcastEvent

	if _, err := server.Start(context.Background()); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
	})

	return &registeredSessionInstance{
		app:         app,
		server:      server,
		projectPath: t.TempDir(),
	}
}

func TestSessionStartUsesGlobalCWDFlag(t *testing.T) {
	inst := startRegisteredSessionInstance(t)

	stdout, stderr, err := runCLI(t, "session", "start", "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "hello")
	if err != nil {
		t.Fatalf("session start failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "claude-session-") {
		t.Fatalf("expected session id in output, got %q", stdout)
	}
}

func TestSessionSendUsesGlobalCWDFlag(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "session", "send", "--session", sessionID, "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "follow up")
	if err != nil {
		t.Fatalf("session send failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "assistant follow-up") {
		t.Fatalf("expected streamed follow-up output, got %q", stdout)
	}
}

type logsFollowRaceRPCSession struct {
	mu          sync.Mutex
	sessionID   string
	first       string
	current     string
	outputCalls int
	running     bool
}

func newLogsFollowRaceRPCSession(sessionID, firstOutput, finalOutput string) *logsFollowRaceRPCSession {
	return &logsFollowRaceRPCSession{
		sessionID: sessionID,
		first:     firstOutput,
		current:   finalOutput,
		running:   true,
	}
}

func (s *logsFollowRaceRPCSession) Call(method string, params []any, out any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch method {
	case "GetProviderSessionOutput":
		output := s.current
		if s.outputCalls == 0 {
			output = s.first
			s.running = false
		}
		s.outputCalls++
		result, ok := out.(*string)
		if !ok {
			return fmt.Errorf("unexpected output type %T", out)
		}
		*result = output
		return nil
	case "ListRunningProviderSessions":
		result, ok := out.(*[]liveProviderSession)
		if !ok {
			return fmt.Errorf("unexpected output type %T", out)
		}
		if s.running {
			*result = []liveProviderSession{{SessionID: s.sessionID, Status: "running"}}
		} else {
			*result = nil
		}
		return nil
	default:
		return fmt.Errorf("unexpected method %q", method)
	}
}

func (s *logsFollowRaceRPCSession) OnEvent(eventType string, handler func(payload json.RawMessage)) {}

func (s *logsFollowRaceRPCSession) Close() error { return nil }

func TestRunSessionLogsFollow_ReplaysMissedOutputAndExitsWhenSessionAlreadyCompleted(t *testing.T) {
	client := newLogsFollowRaceRPCSession("session-1", "initial\n", "initial\nfinal\n")
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	done := make(chan error, 1)
	go func() {
		done <- runSessionLogs(cliState{stdout: &stdout, stderr: &stderr}, client, sessionCommandOptions{sessionID: "session-1", follow: true})
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runSessionLogs failed: %v\n%s", err, stderr.String())
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("runSessionLogs --follow did not return after session completed")
	}

	output := stdout.String()
	if !strings.Contains(output, "initial") {
		t.Fatalf("expected initial snapshot output, got %q", output)
	}
	if !strings.Contains(output, "final") {
		t.Fatalf("expected output produced before subscription to be replayed, got %q", output)
	}
}

func TestSessionStopAgainstLiveInstance(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "session", "stop", "--session", sessionID)
	if err != nil {
		t.Fatalf("session stop failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, sessionID) {
		t.Fatalf("expected stopped session id in output, got %q", stdout)
	}

	stdout, stderr, err = runCLI(t, "session", "list")
	if err != nil {
		t.Fatalf("session list after stop failed: %v\n%s", err, stderr)
	}
	if strings.Contains(stdout, sessionID) {
		t.Fatalf("expected stopped session to be absent from list, got %q", stdout)
	}
}
