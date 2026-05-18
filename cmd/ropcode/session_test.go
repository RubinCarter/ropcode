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

	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/rpc"
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

type rpcClaudeCapability struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	SlashName   string `json:"slash_name"`
	Kind        string `json:"kind"`
	Description string `json:"description,omitempty"`
	Scope       string `json:"scope"`
}

type rpcClaudeCapabilityLayers struct {
	System      []rpcClaudeCapability `json:"system"`
	UserOnly    []rpcClaudeCapability `json:"user_only"`
	ProjectOnly []rpcClaudeCapability `json:"project_only"`
	AllVisible  []rpcClaudeCapability `json:"all_visible"`
	FetchedAt   string                `json:"fetched_at"`
}

type sessionSendCall struct {
	Provider    string
	SessionID   string
	ProjectPath string
	Prompt      string
}

type sessionRPCTestApp struct {
	db                   *database.Database
	mu                   sync.Mutex
	sessions             map[string]*rpcLiveSession
	sends                []sessionSendCall
	broadcaster          func(string, interface{})
	nextID               int
	lastInteractiveAPIID string
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

func (a *sessionRPCTestApp) StartInteractiveClaudeSession(projectPath, model, providerApiID, resumeSessionID string) (string, error) {
	a.mu.Lock()
	a.lastInteractiveAPIID = providerApiID
	// Find existing running session for this project
	var existingID string
	for id, s := range a.sessions {
		if s.ProjectPath == projectPath && s.Status == "running" {
			existingID = id
			break
		}
	}
	a.mu.Unlock()

	if resumeSessionID == "__ROP_FRESH_SESSION__" && existingID != "" {
		_ = a.StopProviderSession(existingID)
		existingID = ""
	}

	if existingID != "" {
		return existingID, nil
	}

	return a.StartProviderSession("claude", projectPath, "", model, providerApiID)
}

func (a *sessionRPCTestApp) SendClaudeMessage(projectPath, sessionID, prompt string) error {
	_, err := a.SendProviderSessionMessage("claude", projectPath, sessionID, prompt)
	return err
}

func (a *sessionRPCTestApp) GetClaudeCapabilityLayers(projectPath string) (rpcClaudeCapabilityLayers, error) {
	return rpcClaudeCapabilityLayers{
		System: []rpcClaudeCapability{{
			Key:       "command:review",
			Name:      "review",
			SlashName: "/review",
			Kind:      "command",
			Scope:     "system",
		}},
		UserOnly: []rpcClaudeCapability{{
			Key:       "skill:loop",
			Name:      "loop",
			SlashName: "/loop",
			Kind:      "skill",
			Scope:     "user",
		}},
		ProjectOnly: []rpcClaudeCapability{{
			Key:       "command:project",
			Name:      "project",
			SlashName: "/project",
			Kind:      "command",
			Scope:     "project",
		}},
		AllVisible: []rpcClaudeCapability{{
			Key:       "command:review",
			Name:      "review",
			SlashName: "/review",
			Kind:      "command",
			Scope:     "system",
		}, {
			Key:       "skill:loop",
			Name:      "loop",
			SlashName: "/loop",
			Kind:      "skill",
			Scope:     "user",
		}, {
			Key:       "command:project",
			Name:      "project",
			SlashName: "/project",
			Kind:      "command",
			Scope:     "project",
		}},
		FetchedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (a *sessionRPCTestApp) RefreshClaudeCapabilityLayers(projectPath string) (rpcClaudeCapabilityLayers, error) {
	return a.GetClaudeCapabilityLayers(projectPath)
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

// CreateWorkspace mimics bindings.go: registers a new workspace under the
// parent project (looked up by basename) without actually invoking git.
func (a *sessionRPCTestApp) CreateWorkspace(parent, branch, name string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	parentName := filepathBase(parent)
	project, err := a.db.GetProjectIndex(parentName)
	if err != nil {
		return err
	}
	if name == "" {
		name = branch
	}
	for _, w := range project.Workspaces {
		if w.Name == name {
			return fmt.Errorf("workspace %q already exists", name)
		}
	}
	workspacePath := parent + "/.ropcode/" + name
	project.Workspaces = append(project.Workspaces, database.WorkspaceIndex{
		Name:    name,
		AddedAt: time.Now().Unix(),
		Branch:  branch,
		Providers: []database.ProviderInfo{{
			ID:         name,
			ProviderID: "claude",
			Path:       workspacePath,
		}},
		LastProvider: "claude",
	})
	return a.db.SaveProjectIndex(project)
}

// GetProjectProviderApiConfig mirrors bindings.go: returns the project-scoped
// API config when set, otherwise the provider's default config, otherwise nil.
func (a *sessionRPCTestApp) GetProjectProviderApiConfig(projectPath, providerName string) (*database.ProviderApiConfig, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	name := filepathBase(projectPath)
	project, err := a.db.GetProjectIndex(name)
	if err == nil {
		for _, p := range project.Providers {
			if p.ProviderID == providerName && p.ProviderApiID != "" {
				return a.db.GetProviderApiConfig(p.ProviderApiID)
			}
		}
	}
	return a.db.GetDefaultProviderApiConfig(providerName)
}

func filepathBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
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

	// 'start' removed; 'send' auto-starts when no running session exists
	_, stderr, err := runCLI(t, "send", "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "hello")
	if err != nil {
		t.Fatalf("send (auto-start) failed: %v\n%s", err, stderr)
	}
}

func TestSessionSendUsesGlobalCWDFlag(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	_, stderr, err := runCLI(t, "send", "--session", sessionID, "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "follow up", "--wait")
	if err != nil {
		t.Fatalf("session send failed: %v\n%s", err, stderr)
	}
	var stdout string
	stdout, stderr, err = runCLI(t, "logs", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("logs failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "assistant follow-up") {
		t.Fatalf("expected follow-up output in logs, got %q", stdout)
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

func TestSessionLogsWithCWDAttachesLatestSession(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "hello", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	// logs with --cwd (no --session) should attach to the running session
	stdout, stderr, err := runCLI(t, "logs", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("session logs with --cwd failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, sessionID) && !strings.Contains(stdout, "hello") {
		t.Fatalf("expected session output, got %q", stdout)
	}
}

func TestSessionLogsRequiresSessionOrCWD(t *testing.T) {
	_, _, err := runCLI(t, "logs")
	if err == nil || (!strings.Contains(err.Error(), "--session") && !strings.Contains(err.Error(), "--cwd")) {
		t.Fatalf("expected error requiring --session or --cwd, got %v", err)
	}
}

func TestClaudeCapabilityLayersRPC(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load failed: %v", err)
	}
	instance, _, err := resolveInstance(defaultCLIDeps(), cfg, inst.server.GetInstanceID())
	if err != nil {
		t.Fatalf("resolveInstance failed: %v", err)
	}
	client, err := rpc.Dial(fmt.Sprintf("ws://%s:%d/ws", instance.Host, instance.Port), instance.AuthKey)
	if err != nil {
		t.Fatalf("rpc.Dial failed: %v", err)
	}
	defer client.Close()

	var getResult rpcClaudeCapabilityLayers
	if err := client.Call("GetClaudeCapabilityLayers", []any{inst.projectPath}, &getResult); err != nil {
		t.Fatalf("GetClaudeCapabilityLayers failed: %v", err)
	}
	assertCapabilityLayerShape(t, getResult)

	var refreshResult rpcClaudeCapabilityLayers
	if err := client.Call("RefreshClaudeCapabilityLayers", []any{inst.projectPath}, &refreshResult); err != nil {
		t.Fatalf("RefreshClaudeCapabilityLayers failed: %v", err)
	}
	assertCapabilityLayerShape(t, refreshResult)
}

func assertCapabilityLayerShape(t *testing.T, layers rpcClaudeCapabilityLayers) {
	t.Helper()
	if len(layers.System) == 0 {
		t.Fatal("expected system capabilities")
	}
	if len(layers.UserOnly) == 0 {
		t.Fatal("expected user_only capabilities")
	}
	if len(layers.ProjectOnly) == 0 {
		t.Fatal("expected project_only capabilities")
	}
	if len(layers.AllVisible) == 0 {
		t.Fatal("expected all_visible capabilities")
	}
	if strings.TrimSpace(layers.FetchedAt) == "" {
		t.Fatal("expected fetched_at timestamp")
	}
}

func TestSessionStopAgainstLiveInstance(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "stop", "--session", sessionID)
	if err != nil {
		t.Fatalf("session stop failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, sessionID) {
		t.Fatalf("expected stopped session id in output, got %q", stdout)
	}

	stdout, stderr, err = runCLI(t, "list", "sessions")
	if err != nil {
		t.Fatalf("list sessions after stop failed: %v\n%s", err, stderr)
	}
	if strings.Contains(stdout, sessionID) {
		t.Fatalf("expected stopped session to be absent from list, got %q", stdout)
	}
}

func TestSessionSendWithCWDAutoResolvesSession(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	_, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	// send without --session, only --cwd
	_, stderr, err := runCLI(t, "send", "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "follow up", "--wait")
	if err != nil {
		t.Fatalf("session send with --cwd failed: %v\n%s", err, stderr)
	}
	var stdout string
	stdout, stderr, err = runCLI(t, "logs", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("logs failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "assistant follow-up") {
		t.Fatalf("expected follow-up output in logs, got %q", stdout)
	}
}

func TestSessionStopWithCWDAutoResolvesSession(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	sessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	// stop without --session, only --cwd
	stdout, stderr, err := runCLI(t, "stop", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("session stop with --cwd failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, sessionID) {
		t.Fatalf("expected stopped session id in output, got %q", stdout)
	}
}

func TestWorkspaceSendFreshStopsAndRestarts(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	oldSessionID, err := inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	// --fresh should stop old session and start a new one
	stdout, stderr, err := runCLI(t, "send", "--cwd", inst.projectPath, "--provider", "claude", "--prompt", "fresh start", "--fresh")
	if err != nil {
		t.Fatalf("send --fresh failed: %v\n%s", err, stderr)
	}
	// old session should no longer be running
	if strings.Contains(stdout, oldSessionID) {
		t.Fatalf("expected old session to be gone, but found %q in output %q", oldSessionID, stdout)
	}
	// verify a new session is now running
	statusOut, statusErr, err2 := runCLI(t, "status", "--cwd", inst.projectPath)
	if err2 != nil {
		t.Fatalf("status failed: %v\n%s", err2, statusErr)
	}
	if !strings.Contains(statusOut, "running") {
		t.Fatalf("expected new session running after --fresh, got %q", statusOut)
	}
}

func TestWorkspaceStatus(t *testing.T) {
	inst := startRegisteredSessionInstance(t)

	// idle when no sessions
	stdout, stderr, err := runCLI(t, "status", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("status failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "idle") {
		t.Fatalf("expected 'idle' when no sessions, got %q", stdout)
	}

	// running when a session exists
	_, err = inst.app.StartProviderSession("claude", inst.projectPath, "initial", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	stdout, stderr, err = runCLI(t, "status", "--cwd", inst.projectPath)
	if err != nil {
		t.Fatalf("status with session failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "running") {
		t.Fatalf("expected 'running' session in status, got %q", stdout)
	}
}

// seedProjectAtPath registers the project at projectPath so that the
// pwd-aware CLI sees it as a project root.
func seedProjectAtPath(t *testing.T, db *database.Database, name, path string) {
	t.Helper()
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      name,
		Available: true,
		Providers: []database.ProviderInfo{{Path: path, ID: name, ProviderID: "claude"}},
	})
}

func TestSendCreateRegistersWorkspaceAndChainsPrompt(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	seedProjectAtPath(t, inst.app.db, filepathBase(inst.projectPath), inst.projectPath)

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return inst.projectPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "feat-login", "--create", "--prompt", "scaffold", "--wait"}, &stdout, &stderr, deps)
	if err != nil {
		t.Fatalf("send --create failed: %v\n%s", err, stderr.String())
	}

	if !strings.Contains(stdout.String(), "created\tfeat-login") {
		t.Fatalf("expected 'created' acknowledgement, got %q", stdout.String())
	}

	// The new workspace must now appear in the project index, with name == branch.
	project, err := inst.app.db.GetProjectIndex(filepathBase(inst.projectPath))
	if err != nil {
		t.Fatalf("GetProjectIndex failed: %v", err)
	}
	var found *database.WorkspaceIndex
	for i := range project.Workspaces {
		if project.Workspaces[i].Name == "feat-login" {
			found = &project.Workspaces[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("workspace feat-login not registered: %+v", project.Workspaces)
	}
	if found.Branch != "feat-login" {
		t.Fatalf("expected branch == name (\"feat-login\"), got %q", found.Branch)
	}

	// The chained send should have hit the new workspace's path.
	wsPath := workspacePrimaryPath(found)
	inst.app.mu.Lock()
	defer inst.app.mu.Unlock()
	hit := false
	for _, s := range inst.app.sessions {
		if s.ProjectPath == wsPath {
			hit = true
			break
		}
	}
	if !hit {
		t.Fatalf("expected a session for new workspace path %q, sessions=%+v", wsPath, inst.app.sessions)
	}
}

func TestSendCreateRefusesExistingWorkspace(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	projName := filepathBase(inst.projectPath)
	seedProjectIndex(t, inst.app.db, &database.ProjectIndex{
		Name:      projName,
		Available: true,
		Providers: []database.ProviderInfo{{Path: inst.projectPath, ID: projName, ProviderID: "claude"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "feat-login",
			Branch:    "feat-login",
			Providers: []database.ProviderInfo{{Path: inst.projectPath + "/.ropcode/feat-login"}},
		}},
	})

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return inst.projectPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "feat-login", "--create", "--prompt", "x"}, &stdout, &stderr, deps)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("expected already-exists error, got %v", err)
	}
}

func TestSendCreateRejectsCWDFlag(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	seedProjectAtPath(t, inst.app.db, filepathBase(inst.projectPath), inst.projectPath)

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return inst.projectPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "feat-login", "--create", "--cwd", "/tmp/x", "--prompt", "x"}, &stdout, &stderr, deps)
	if err == nil || !strings.Contains(err.Error(), "--cwd") {
		t.Fatalf("expected --cwd conflict error, got %v", err)
	}
}

func TestSendCreateNeedsName(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	seedProjectAtPath(t, inst.app.db, filepathBase(inst.projectPath), inst.projectPath)

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return inst.projectPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "--create", "--prompt", "x"}, &stdout, &stderr, deps)
	if err == nil || !strings.Contains(err.Error(), "workspace name") {
		t.Fatalf("expected name-required error, got %v", err)
	}
}

func TestSendCreateNeedsParent(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	seedProjectAtPath(t, inst.app.db, filepathBase(inst.projectPath), inst.projectPath)

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return "/var/empty/no-such-place", nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "feat-login", "--create", "--prompt", "x"}, &stdout, &stderr, deps)
	if err == nil || !strings.Contains(err.Error(), "parent project") {
		t.Fatalf("expected missing-parent error, got %v", err)
	}
}

func TestSendForwardsResolvedProviderApiID(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	projName := filepathBase(inst.projectPath)
	wsPath := inst.projectPath + "/.ropcode/ws-a"

	apiCfg := &database.ProviderApiConfig{
		ID:         "claude-default-cfg",
		Name:       "claude default",
		ProviderID: "claude",
		BaseURL:    "https://api.example.test/v1",
		AuthToken:  "tok-xyz",
		IsDefault:  true,
	}
	if err := inst.app.db.SaveProviderApiConfig(apiCfg); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}
	seedProjectIndex(t, inst.app.db, &database.ProjectIndex{
		Name:      projName,
		Available: true,
		Providers: []database.ProviderInfo{{Path: inst.projectPath, ID: projName, ProviderID: "claude"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Branch:    "ws-a",
			Providers: []database.ProviderInfo{{Path: wsPath, ID: "ws-a", ProviderID: "claude"}},
		}},
	})

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return wsPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "--prompt", "hi"}, &stdout, &stderr, deps)
	if err != nil {
		t.Fatalf("send failed: %v\n%s", err, stderr.String())
	}

	inst.app.mu.Lock()
	got := inst.app.lastInteractiveAPIID
	inst.app.mu.Unlock()
	if got != apiCfg.ID {
		t.Fatalf("expected CLI to forward providerApiID %q, got %q", apiCfg.ID, got)
	}
}

func TestSendRespectsExplicitProviderApiID(t *testing.T) {
	inst := startRegisteredSessionInstance(t)
	projName := filepathBase(inst.projectPath)
	wsPath := inst.projectPath + "/.ropcode/ws-a"

	if err := inst.app.db.SaveProviderApiConfig(&database.ProviderApiConfig{
		ID:         "default-cfg",
		Name:       "default",
		ProviderID: "claude",
		IsDefault:  true,
	}); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}
	seedProjectIndex(t, inst.app.db, &database.ProjectIndex{
		Name:      projName,
		Available: true,
		Providers: []database.ProviderInfo{{Path: inst.projectPath, ID: projName, ProviderID: "claude"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Branch:    "ws-a",
			Providers: []database.ProviderInfo{{Path: wsPath, ID: "ws-a", ProviderID: "claude"}},
		}},
	})

	deps := defaultCLIDeps()
	deps.getwd = func() (string, error) { return wsPath, nil }

	var stdout, stderr bytes.Buffer
	err := runCLIArgs([]string{"send", "--provider-api-id", "explicit-cfg", "--prompt", "hi"}, &stdout, &stderr, deps)
	if err != nil {
		t.Fatalf("send failed: %v\n%s", err, stderr.String())
	}

	inst.app.mu.Lock()
	got := inst.app.lastInteractiveAPIID
	inst.app.mu.Unlock()
	if got != "explicit-cfg" {
		t.Fatalf("expected explicit providerApiID forwarded verbatim, got %q", got)
	}
}
