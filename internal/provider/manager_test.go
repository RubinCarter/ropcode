package provider

import (
	"context"
	"sync"
	"testing"
	"time"
)

// mockEmitter 收集发出的事件用于断言。
type mockEmitter struct {
	mu     sync.Mutex
	events []mockEvent
}

type mockEvent struct {
	name string
	data interface{}
}

func (e *mockEmitter) Emit(name string, data interface{}) {
	e.mu.Lock()
	e.events = append(e.events, mockEvent{name, data})
	e.mu.Unlock()
}

func (e *mockEmitter) count(name string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for _, ev := range e.events {
		if ev.name == name {
			n++
		}
	}
	return n
}

func TestManager_RegisterDriver(t *testing.T) {
	ctx := context.Background()
	emitter := &mockEmitter{}
	m := NewManager(ctx, emitter, nil)
	defer m.Shutdown()

	driver := &echoDriver{}
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatal(err)
	}

	err := m.RegisterDriver(driver)
	if err == nil {
		t.Fatal("expected error on duplicate registration")
	}
}

func TestManager_StartSession_UnknownProvider(t *testing.T) {
	ctx := context.Background()
	emitter := &mockEmitter{}
	m := NewManager(ctx, emitter, nil)
	defer m.Shutdown()

	_, err := m.StartSession("nonexistent", SessionConfig{Prompt: "hello"})
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestManager_StartSession_Echo(t *testing.T) {
	ctx := context.Background()
	emitter := &mockEmitter{}
	m := NewManager(ctx, emitter, nil)
	defer m.Shutdown()

	m.RegisterDriver(&echoDriver{})

	sessionID, err := m.StartSession("echo", SessionConfig{
		ProjectPath: t.TempDir(),
		Prompt:      "hello world",
	})
	if err != nil {
		t.Fatalf("start session: %v", err)
	}
	if sessionID == "" {
		t.Fatal("expected non-empty session ID")
	}

	if !m.IsRunning(sessionID) {
		t.Fatal("expected session to be running")
	}

	// Wait for echo process to complete
	time.Sleep(500 * time.Millisecond)

	status := m.GetSession(sessionID)
	if status == nil {
		t.Fatal("expected session status")
	}
	if status.ProviderID != "echo" {
		t.Fatalf("expected provider 'echo', got %q", status.ProviderID)
	}
}

func TestManager_TerminateSession(t *testing.T) {
	ctx := context.Background()
	emitter := &mockEmitter{}
	m := NewManager(ctx, emitter, nil)
	defer m.Shutdown()

	m.RegisterDriver(&sleepDriver{})

	sessionID, err := m.StartSession("sleep", SessionConfig{
		ProjectPath: t.TempDir(),
		Prompt:      "test",
	})
	if err != nil {
		t.Fatalf("start session: %v", err)
	}

	time.Sleep(100 * time.Millisecond)
	if !m.IsRunning(sessionID) {
		t.Fatal("expected session to be running")
	}

	if err := m.TerminateSession(sessionID); err != nil {
		t.Fatalf("terminate: %v", err)
	}

	time.Sleep(500 * time.Millisecond)
	if m.IsRunning(sessionID) {
		t.Fatal("expected session to be stopped after terminate")
	}
}

func TestManager_SendMessage_Enqueue(t *testing.T) {
	ctx := context.Background()
	emitter := &mockEmitter{}
	m := NewManager(ctx, emitter, nil)
	defer m.Shutdown()

	m.RegisterDriver(&echoDriver{})

	sessionID, err := m.StartSession("echo", SessionConfig{
		ProjectPath: t.TempDir(),
		Prompt:      "first",
	})
	if err != nil {
		t.Fatal(err)
	}

	// echo driver enqueues messages
	if err := m.SendMessage(sessionID, "second message"); err != nil {
		t.Fatalf("send message: %v", err)
	}
}

func TestMonitor_HealthTransitions(t *testing.T) {
	var mu sync.Mutex
	var changes []ProcessHealth

	cfg := MonitorConfig{
		CheckInterval:  50 * time.Millisecond,
		SlowThreshold:  100 * time.Millisecond,
		StuckThreshold: 200 * time.Millisecond,
		HangThreshold:  400 * time.Millisecond,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mon := NewMonitor(ctx, cfg, func(id string, h ProcessHealth) {
		mu.Lock()
		changes = append(changes, h)
		mu.Unlock()
	})
	defer mon.Stop()

	mon.Register("test-session")

	// Wait for slow threshold
	time.Sleep(180 * time.Millisecond)

	mu.Lock()
	hasSlow := false
	for _, h := range changes {
		if h == HealthSlow {
			hasSlow = true
		}
	}
	mu.Unlock()

	if !hasSlow {
		t.Error("expected HealthSlow transition")
	}

	// Record output should reset to OK
	mon.RecordOutput("test-session")
	time.Sleep(80 * time.Millisecond)

	mu.Lock()
	hasOK := false
	for _, h := range changes {
		if h == HealthOK {
			hasOK = true
		}
	}
	mu.Unlock()

	if !hasOK {
		t.Error("expected HealthOK after RecordOutput")
	}
}

func TestMarkInitializedDoesNotEmitSyntheticInit(t *testing.T) {
	emitter := &mockEmitter{}
	session := newSession(
		context.Background(),
		"session-1",
		&echoDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		emitter,
		nil,
		nil,
	)

	session.MarkInitialized()

	if got := emitter.count("provider-output"); got != 0 {
		t.Fatalf("expected no synthetic provider-output init, got %d", got)
	}
	select {
	case <-session.initDone:
	case <-time.After(time.Second):
		t.Fatal("expected initDone to close")
	}
}

// === Test Drivers ===

// echoDriver uses "echo" command — runs and exits immediately.
type echoDriver struct{}

func (d *echoDriver) ID() string         { return "echo" }
func (d *echoDriver) BinaryName() string { return "echo" }
func (d *echoDriver) BinaryCandidates() []string {
	return []string{"/bin/echo", "/usr/bin/echo"}
}
func (d *echoDriver) BuildArgs(config SessionConfig) []string {
	return []string{config.Prompt}
}
func (d *echoDriver) EnvVars(config SessionConfig) map[string]string { return nil }
func (d *echoDriver) ParseOutput(line []byte) *OutputEvent {
	return &OutputEvent{Type: "assistant", Raw: string(line)}
}
func (d *echoDriver) ParseStderr(line []byte) *StderrEvent {
	return &StderrEvent{Level: "error", Message: string(line)}
}
func (d *echoDriver) SendMessage(session SessionHandle, msg string) error {
	session.EnqueueMessage(msg)
	return nil
}
func (d *echoDriver) Interrupt(session SessionHandle) error {
	return session.Kill()
}
func (d *echoDriver) SetModel(session SessionHandle, model string) error {
	session.UpdateConfig(func(c *SessionConfig) { c.Model = model })
	return nil
}
func (d *echoDriver) SetPermissionMode(session SessionHandle, mode string) error { return nil }
func (d *echoDriver) UpdateEnvironmentVariables(session SessionHandle, vars map[string]string) error {
	return nil
}
func (d *echoDriver) WaitForInit(session SessionHandle, timeout time.Duration) error { return nil }
func (d *echoDriver) OnProcessStart(_ context.Context, _ SessionHandle, _ int) error { return nil }
func (d *echoDriver) OnProcessExit(session SessionHandle, exitCode int, err error) {
	if msg, ok := session.DequeueMessage(); ok {
		config := session.GetConfig()
		config.Prompt = msg
		session.RestartWithConfig(config)
	}
}

// sleepDriver uses "sleep" command — runs for a long time until terminated.
type sleepDriver struct{}

func (d *sleepDriver) ID() string         { return "sleep" }
func (d *sleepDriver) BinaryName() string { return "sleep" }
func (d *sleepDriver) BinaryCandidates() []string {
	return []string{"/bin/sleep", "/usr/bin/sleep"}
}
func (d *sleepDriver) BuildArgs(config SessionConfig) []string {
	return []string{"60"}
}
func (d *sleepDriver) EnvVars(config SessionConfig) map[string]string { return nil }
func (d *sleepDriver) ParseOutput(line []byte) *OutputEvent {
	return &OutputEvent{Type: "raw", Raw: string(line)}
}
func (d *sleepDriver) ParseStderr(line []byte) *StderrEvent {
	return &StderrEvent{Level: "error", Message: string(line)}
}
func (d *sleepDriver) SendMessage(session SessionHandle, msg string) error {
	session.EnqueueMessage(msg)
	return nil
}
func (d *sleepDriver) Interrupt(session SessionHandle) error {
	return session.Kill()
}
func (d *sleepDriver) SetModel(session SessionHandle, model string) error {
	session.UpdateConfig(func(c *SessionConfig) { c.Model = model })
	return nil
}
func (d *sleepDriver) SetPermissionMode(session SessionHandle, mode string) error { return nil }
func (d *sleepDriver) UpdateEnvironmentVariables(session SessionHandle, vars map[string]string) error {
	return nil
}
func (d *sleepDriver) WaitForInit(session SessionHandle, timeout time.Duration) error { return nil }
func (d *sleepDriver) OnProcessStart(_ context.Context, _ SessionHandle, _ int) error { return nil }
func (d *sleepDriver) OnProcessExit(session SessionHandle, exitCode int, err error)   {}
