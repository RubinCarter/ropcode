package main

import (
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

func TestSessionStartAndListAgainstLiveInstance(t *testing.T) {
	inst := startRegisteredSessionInstance(t)

	stdout, stderr, err := runCLI(t, "session", "start", "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "hello")
	if err != nil {
		t.Fatalf("session start failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "claude-session-") {
		t.Fatalf("expected session id in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "assistant reply") {
		t.Fatalf("expected streamed output, got %q", stdout)
	}

	stdout, stderr, err = runCLI(t, "session", "list")
	if err != nil {
		t.Fatalf("session list failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, inst.projectPath) {
		t.Fatalf("expected session list output to mention project path, got %q", stdout)
	}
	if !strings.Contains(stdout, "claude") {
		t.Fatalf("expected session list output to mention provider, got %q", stdout)
	}
}

func TestSessionSendUsesLiveSession(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "session", "send", "--session", sessionID, "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "follow up")
	if err != nil {
		t.Fatalf("session send failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "follow up") {
		t.Fatalf("expected sent prompt in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "assistant follow-up") {
		t.Fatalf("expected streamed follow-up output, got %q", stdout)
	}
}

func TestSessionLogsAndFollow(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "session", "logs", "--session", sessionID)
	if err != nil {
		t.Fatalf("session logs failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "assistant reply") {
		t.Fatalf("expected current output in logs, got %q", stdout)
	}

	followDone := make(chan struct{})
	var followStdout, followStderr string
	var followErr error
	go func() {
		followStdout, followStderr, followErr = runCLI(t, "session", "logs", "--session", sessionID, "--follow")
		close(followDone)
	}()

	time.Sleep(50 * time.Millisecond)
	inst.app.emitOutput(sessionID, inst.projectPath, "claude", "follow line")
	inst.app.completeSession(sessionID)

	select {
	case <-followDone:
	case <-time.After(3 * time.Second):
		t.Fatal("session logs --follow did not finish")
	}
	if followErr != nil {
		t.Fatalf("session logs --follow failed: %v\n%s", followErr, followStderr)
	}
	if !strings.Contains(followStdout, "follow line") {
		t.Fatalf("expected followed output, got %q", followStdout)
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
