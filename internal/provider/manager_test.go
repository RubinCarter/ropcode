package provider

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// mockEmitter records emitted events for assertions.
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

func (e *mockEmitter) eventsByName(name string) []mockEvent {
	e.mu.Lock()
	defer e.mu.Unlock()
	events := make([]mockEvent, 0)
	for _, ev := range e.events {
		if ev.name == name {
			events = append(events, ev)
		}
	}
	return events
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

func TestManager_SendMessage_ProviderCommandUsesDriverHandler(t *testing.T) {
	driver := &commandDriver{}
	session := newSession(
		context.Background(),
		"session-1",
		driver,
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.state = StateRunning

	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	if err := m.SendMessage(session.ID, "/native"); err != nil {
		t.Fatalf("send provider command: %v", err)
	}

	driver.mu.Lock()
	defer driver.mu.Unlock()
	if len(driver.handled) != 1 || driver.handled[0] != "/native" {
		t.Fatalf("expected provider command handler to run once, got %#v", driver.handled)
	}
	if len(driver.sent) != 0 {
		t.Fatalf("expected regular SendMessage not to run, got %#v", driver.sent)
	}
}

func TestManager_SendMessage_ExpandsProviderCapability(t *testing.T) {
	driver := &capabilityDriver{}
	projectPath := t.TempDir()
	session := newSession(
		context.Background(),
		"session-1",
		driver,
		SessionConfig{ProjectPath: projectPath, Interactive: true},
		nil,
		nil,
		nil,
	)
	session.state = StateRunning

	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatalf("register driver: %v", err)
	}
	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	if err := m.SendMessage(session.ID, "/commit-as-prompt ship it"); err != nil {
		t.Fatalf("send capability invocation: %v", err)
	}

	driver.mu.Lock()
	defer driver.mu.Unlock()
	if len(driver.sent) != 1 {
		t.Fatalf("expected one expanded send, got %#v", driver.sent)
	}
	if driver.sent[0] != "Commit this change:\n\nship it" {
		t.Fatalf("expected expanded capability prompt, got %q", driver.sent[0])
	}
}

func TestManager_ExpandProviderCapability_PreservesInjectedWrappers(t *testing.T) {
	driver := &capabilityDriver{}
	projectPath := t.TempDir()
	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatalf("register driver: %v", err)
	}

	message := "<previous_conversation>\n[User]: hello\n</previous_conversation>\n\n/system-check status"
	expanded, err := m.ExpandProviderCapability(driver.ID(), projectPath, message)
	if err != nil {
		t.Fatalf("expand provider capability: %v", err)
	}
	if !strings.Contains(expanded, "<previous_conversation>") {
		t.Fatalf("expected wrapper to be preserved, got %q", expanded)
	}
	if !strings.Contains(expanded, "Check the system:\n\nstatus") {
		t.Fatalf("expected capability body to replace invocation, got %q", expanded)
	}
	if strings.Contains(expanded, "/system-check") {
		t.Fatalf("expected raw slash invocation to be removed, got %q", expanded)
	}
}

func TestManager_ExpandProviderCapability_ReplacesInvocationBetweenSystemWrappers(t *testing.T) {
	driver := &capabilityDriver{}
	projectPath := t.TempDir()
	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatalf("register driver: %v", err)
	}

	message := "<system_instruction>\nUse the workspace.\n</system_instruction>\n\n/commit-as-prompt ship it\n\n<system-instruction>\nRename the branch.\n</system-instruction>"
	expanded, err := m.ExpandProviderCapability(driver.ID(), projectPath, message)
	if err != nil {
		t.Fatalf("expand provider capability: %v", err)
	}
	expected := "<system_instruction>\nUse the workspace.\n</system_instruction>\n\nCommit this change:\n\nship it\n\n<system-instruction>\nRename the branch.\n</system-instruction>"
	if expanded != expected {
		t.Fatalf("unexpected expanded wrapper order:\nwant: %q\n got: %q", expected, expanded)
	}
}

func TestManager_ExpandProviderCapability_ReplacesColonSkillInvocation(t *testing.T) {
	driver := &capabilityDriver{}
	projectPath := t.TempDir()
	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatalf("register driver: %v", err)
	}

	message := "<system_instruction>\nUse the workspace.\n</system_instruction>\n\n:demo-skill render a poster"
	expanded, err := m.ExpandProviderCapability(driver.ID(), projectPath, message)
	if err != nil {
		t.Fatalf("expand provider capability: %v", err)
	}
	if !strings.Contains(expanded, "<system_instruction>") {
		t.Fatalf("expected wrapper to be preserved, got %q", expanded)
	}
	if !strings.Contains(expanded, "Use the demo skill:\n\nrender a poster") {
		t.Fatalf("expected colon skill invocation to expand, got %q", expanded)
	}
	if strings.Contains(expanded, ":demo-skill") {
		t.Fatalf("expected raw colon invocation to be removed, got %q", expanded)
	}
}

func TestManager_ExpandProviderCapability_RejectsUnhandledCommand(t *testing.T) {
	driver := &capabilityDriver{}
	projectPath := t.TempDir()
	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	if err := m.RegisterDriver(driver); err != nil {
		t.Fatalf("register driver: %v", err)
	}

	_, err := m.ExpandProviderCapability(driver.ID(), projectPath, "/native-only")
	if err == nil {
		t.Fatal("expected missing handler error for command without prompt content")
	}
	if !strings.Contains(err.Error(), "has no app-server handler") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestManager_QueryProviderSessionActivity_UsesDriverQuery(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&activityDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.SetProviderSessionID("native-1")
	session.state = StateRunning

	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	activity, err := m.QueryProviderSessionActivityForProject(session.config.ProjectPath, "native-1", time.Second)
	if err != nil {
		t.Fatalf("query activity: %v", err)
	}
	if activity.Status != SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active activity, got %#v", activity)
	}
	if activity.SessionID != "session-1" || activity.ProviderSessionID != "native-1" {
		t.Fatalf("expected base session ids to be preserved, got %#v", activity)
	}
}

func TestManager_QueryProviderSessionActivity_UsesDefaultDriverActivity(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&echoDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.SetProviderSessionID("native-1")
	session.state = StateRunning
	session.MarkActivityActive()

	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	activity, err := m.QueryProviderSessionActivityForProject(session.config.ProjectPath, "native-1", time.Second)
	if err != nil {
		t.Fatalf("query activity: %v", err)
	}
	if activity.Status != SessionActivityActive || !activity.Running || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active fallback activity, got %#v", activity)
	}
	if activity.ProviderID != "echo" || activity.SessionID != "session-1" || activity.ProviderSessionID != "native-1" {
		t.Fatalf("expected fallback session metadata, got %#v", activity)
	}
}

func TestManager_QueryProviderSessionActivity_PreservesActiveBaseOverIdleQuery(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&idleQueryDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.SetProviderSessionID("native-1")
	session.state = StateRunning
	session.MarkActivityActive()

	m := NewManager(context.Background(), nil, nil)
	defer m.Shutdown()
	m.mu.Lock()
	m.sessions[session.ID] = session
	m.mu.Unlock()

	activity, err := m.QueryProviderSessionActivityForProject(session.config.ProjectPath, "native-1", time.Second)
	if err != nil {
		t.Fatalf("query activity: %v", err)
	}
	if activity.Status != SessionActivityActive || !activity.Running || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active base activity to survive idle query, got %#v", activity)
	}
	if activity.ProviderSessionID != "native-1" {
		t.Fatalf("expected provider session id to be preserved, got %#v", activity)
	}
}

func TestSessionActivityUsesSessionStateChangedEvents(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&echoDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.SetProviderSessionID("native-1")
	session.state = StateRunning

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "system",
		Subtype: "session_state_changed",
		Message: map[string]interface{}{
			"state": "running",
		},
	})
	activity := session.Activity()
	if activity.Status != SessionActivityActive || !activity.Active || !activity.CanInterrupt || activity.ThreadStatus != "running" {
		t.Fatalf("expected running session activity, got %#v", activity)
	}

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "system",
		Subtype: "session_state_changed",
		Message: map[string]interface{}{
			"state": "idle",
		},
	})
	activity = session.Activity()
	if activity.Status != SessionActivityIdle || activity.Active || activity.CanInterrupt || activity.ThreadStatus != "idle" {
		t.Fatalf("expected idle session activity, got %#v", activity)
	}
}

func TestSessionActivityChangedEventsAreEmittedFromProviderEvents(t *testing.T) {
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
	session.SetProviderSessionID("native-1")
	session.state = StateRunning

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "system",
		Subtype: "session_state_changed",
		Message: map[string]interface{}{
			"state": "running",
		},
	})

	events := emitter.eventsByName(ProviderActivityChangedEvent)
	if len(events) != 2 {
		t.Fatalf("expected provider session id and running activity events, got %d", len(events))
	}
	activity, ok := events[1].data.(SessionActivity)
	if !ok {
		t.Fatalf("expected SessionActivity payload, got %T", events[1].data)
	}
	if activity.SessionID != "session-1" || activity.ProviderID != "echo" || activity.ProviderSessionID != "native-1" {
		t.Fatalf("expected provider activity identity, got %#v", activity)
	}
	if activity.Status != SessionActivityActive || !activity.Running || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active activity event, got %#v", activity)
	}

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "system",
		Subtype: "session_state_changed",
		Message: map[string]interface{}{
			"state": "running",
		},
	})
	if got := len(emitter.eventsByName(ProviderActivityChangedEvent)); got != 2 {
		t.Fatalf("expected unchanged activity to skip duplicate events, got %d", got)
	}

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "system",
		Subtype: "session_state_changed",
		Message: map[string]interface{}{
			"state": "idle",
		},
	})
	events = emitter.eventsByName(ProviderActivityChangedEvent)
	if len(events) != 3 {
		t.Fatalf("expected idle activity event, got %d events", len(events))
	}
	activity = events[2].data.(SessionActivity)
	if activity.Status != SessionActivityIdle || activity.Active || activity.CanInterrupt {
		t.Fatalf("expected idle activity event, got %#v", activity)
	}
}

func TestMarkActivityActiveEmitsUnifiedProviderActivity(t *testing.T) {
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
	session.state = StateRunning

	session.MarkActivityActive()

	events := emitter.eventsByName(ProviderActivityChangedEvent)
	if len(events) != 1 {
		t.Fatalf("expected one activity event, got %d", len(events))
	}
	activity, ok := events[0].data.(SessionActivity)
	if !ok {
		t.Fatalf("expected SessionActivity payload, got %T", events[0].data)
	}
	if activity.Status != SessionActivityActive || !activity.Running || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active activity event, got %#v", activity)
	}
}

func TestSessionActivityIgnoresSidechainTerminalEvents(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&echoDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.state = StateRunning
	session.MarkActivityActive()

	session.updateActivityFromEvent(&OutputEvent{
		Type:    "assistant",
		Subtype: "result",
		Message: map[string]interface{}{
			"type":               "result",
			"isSidechain":        true,
			"parent_tool_use_id": "call-1",
		},
	})

	activity := session.Activity()
	if activity.Status != SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected sidechain result to preserve active main session, got %#v", activity)
	}
}

func TestSessionActivityUsesAssistantToolUseAsActive(t *testing.T) {
	session := newSession(
		context.Background(),
		"session-1",
		&echoDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Interactive: true},
		nil,
		nil,
		nil,
	)
	session.state = StateRunning

	session.updateActivityFromEvent(&OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []interface{}{
					map[string]interface{}{
						"type": "tool_use",
						"id":   "call-1",
						"name": "Bash",
						"input": map[string]interface{}{
							"command": "go test ./...",
						},
					},
				},
			},
		},
	})

	activity := session.Activity()
	if activity.Status != SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected assistant tool_use to mark session active, got %#v", activity)
	}

	session.updateActivityFromEvent(&OutputEvent{
		Type: "user",
		Message: map[string]interface{}{
			"type": "user",
			"message": map[string]interface{}{
				"role": "user",
				"content": []interface{}{
					map[string]interface{}{
						"type":        "tool_result",
						"tool_use_id": "call-1",
						"content":     "ok",
					},
				},
			},
		},
	})
	activity = session.Activity()
	if activity.Status != SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected tool_result to preserve active session until turn completion, got %#v", activity)
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

func TestBatchSessionDoesNotAttachStdinPipe(t *testing.T) {
	if os.Getenv("ROPCODE_PROVIDER_STDIN_HELPER") == "1" {
		fmt.Println("ok")
		return
	}

	session := newSession(
		context.Background(),
		"batch-session",
		&stdinProbeDriver{},
		SessionConfig{ProjectPath: t.TempDir(), Prompt: "probe"},
		nil,
		nil,
		nil,
	)
	session.binaryPath = os.Args[0]

	if err := session.Start(); err != nil {
		t.Fatalf("start session: %v", err)
	}
	waitForSessionDone(t, session, 2*time.Second)
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
func (d *echoDriver) QuerySessionActivity(session SessionHandle, timeout time.Duration) (*SessionActivity, error) {
	return DefaultSessionActivity(session), nil
}
func (d *echoDriver) OnProcessStart(_ context.Context, _ SessionHandle, _ int) error { return nil }
func (d *echoDriver) OnProcessExit(session SessionHandle, exitCode int, err error) {
	if msg, ok := session.DequeueMessage(); ok {
		config := session.GetConfig()
		config.Prompt = msg
		session.RestartWithConfig(config)
	}
}

type commandDriver struct {
	echoDriver
	mu      sync.Mutex
	sent    []string
	handled []string
}

func (d *commandDriver) ID() string { return "command" }

func (d *commandDriver) SendMessage(session SessionHandle, msg string) error {
	d.mu.Lock()
	d.sent = append(d.sent, msg)
	d.mu.Unlock()
	return nil
}

func (d *commandDriver) IsProviderCommand(message string) bool {
	return strings.TrimSpace(message) == "/native"
}

func (d *commandDriver) HandleProviderCommand(session SessionHandle, message string) error {
	d.mu.Lock()
	d.handled = append(d.handled, message)
	d.mu.Unlock()
	return nil
}

type capabilityDriver struct {
	echoDriver
	mu   sync.Mutex
	sent []string
}

func (d *capabilityDriver) ID() string { return "capability" }

func (d *capabilityDriver) SendMessage(session SessionHandle, msg string) error {
	d.mu.Lock()
	d.sent = append(d.sent, msg)
	d.mu.Unlock()
	return nil
}

func (d *capabilityDriver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (CapabilityLayers, error) {
	return NormalizeCapabilityLayers(d.ID(), []Capability{
		{
			Provider:    d.ID(),
			Name:        "commit-as-prompt",
			SlashName:   "/commit-as-prompt",
			Kind:        string(CapabilityKindCommand),
			Scope:       string(CapabilityScopeUser),
			Content:     "Commit this change:\n\n$ARGUMENTS",
			SourcePath:  projectPath + "/commit-as-prompt.md",
			Description: "Commit changes",
		},
		{
			Provider:    d.ID(),
			Name:        "system-check",
			SlashName:   "/system-check",
			Kind:        string(CapabilityKindCommand),
			Scope:       string(CapabilityScopeProject),
			Content:     "Check the system:",
			Description: "Check system",
		},
		{
			Provider:    d.ID(),
			Name:        "demo-skill",
			SlashName:   "/demo-skill",
			Kind:        string(CapabilityKindSkill),
			Scope:       string(CapabilityScopeUser),
			Content:     "Use the demo skill:\n\n$ARGUMENTS",
			Description: "Demo skill",
		},
		{
			Provider:    d.ID(),
			Name:        "native-only",
			SlashName:   "/native-only",
			Kind:        string(CapabilityKindCommand),
			Scope:       string(CapabilityScopeSystem),
			Description: "Native command without provider handler",
		},
	}), nil
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
func (d *sleepDriver) QuerySessionActivity(session SessionHandle, timeout time.Duration) (*SessionActivity, error) {
	return DefaultSessionActivity(session), nil
}
func (d *sleepDriver) OnProcessStart(_ context.Context, _ SessionHandle, _ int) error { return nil }
func (d *sleepDriver) OnProcessExit(session SessionHandle, exitCode int, err error)   {}

type stdinProbeDriver struct{}

func (d *stdinProbeDriver) ID() string         { return "stdin-probe" }
func (d *stdinProbeDriver) BinaryName() string { return os.Args[0] }
func (d *stdinProbeDriver) BinaryCandidates() []string {
	return []string{os.Args[0]}
}
func (d *stdinProbeDriver) BuildArgs(config SessionConfig) []string {
	return []string{"-test.run=TestBatchSessionDoesNotAttachStdinPipe", "--"}
}
func (d *stdinProbeDriver) EnvVars(config SessionConfig) map[string]string {
	return map[string]string{"ROPCODE_PROVIDER_STDIN_HELPER": "1"}
}
func (d *stdinProbeDriver) ParseOutput(line []byte) *OutputEvent {
	return &OutputEvent{Type: "raw", Raw: string(line)}
}
func (d *stdinProbeDriver) ParseStderr(line []byte) *StderrEvent {
	return &StderrEvent{Level: "error", Message: string(line)}
}
func (d *stdinProbeDriver) SendMessage(session SessionHandle, msg string) error {
	return nil
}
func (d *stdinProbeDriver) Interrupt(session SessionHandle) error {
	return session.Kill()
}
func (d *stdinProbeDriver) SetModel(session SessionHandle, model string) error { return nil }
func (d *stdinProbeDriver) SetPermissionMode(session SessionHandle, mode string) error {
	return nil
}
func (d *stdinProbeDriver) UpdateEnvironmentVariables(session SessionHandle, vars map[string]string) error {
	return nil
}
func (d *stdinProbeDriver) WaitForInit(session SessionHandle, timeout time.Duration) error {
	return nil
}
func (d *stdinProbeDriver) QuerySessionActivity(session SessionHandle, timeout time.Duration) (*SessionActivity, error) {
	return DefaultSessionActivity(session), nil
}
func (d *stdinProbeDriver) OnProcessStart(_ context.Context, session SessionHandle, _ int) error {
	if concrete, ok := session.(*Session); ok && concrete.stdin != nil {
		return fmt.Errorf("batch session should not retain stdin pipe")
	}
	return nil
}
func (d *stdinProbeDriver) OnProcessExit(session SessionHandle, exitCode int, err error) {}

type activityDriver struct {
	echoDriver
}

func (d *activityDriver) ID() string { return "activity" }

func (d *activityDriver) QuerySessionActivity(session SessionHandle, timeout time.Duration) (*SessionActivity, error) {
	return &SessionActivity{
		Status:       SessionActivityActive,
		Running:      true,
		Active:       true,
		CanInterrupt: true,
		TurnID:       "turn-1",
	}, nil
}

type idleQueryDriver struct {
	echoDriver
}

func (d *idleQueryDriver) ID() string { return "idle-query" }

func (d *idleQueryDriver) QuerySessionActivity(session SessionHandle, timeout time.Duration) (*SessionActivity, error) {
	return &SessionActivity{
		Status:            SessionActivityIdle,
		Running:           true,
		Active:            false,
		CanInterrupt:      false,
		ProviderSessionID: session.GetProviderSessionID(),
		ThreadStatus:      "idle",
	}, nil
}

func waitForSessionDone(t *testing.T, session *Session, timeout time.Duration) {
	t.Helper()
	select {
	case <-session.done:
	case <-time.After(timeout):
		t.Fatalf("session did not exit within %s", timeout)
	}
}
