package projectchat

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/provider"
)

type testEmitter struct{}

func (e *testEmitter) Emit(name string, data interface{}) {}

type resumeProbeDriver struct {
	id      string
	mu      sync.Mutex
	starts  []provider.SessionConfig
	resumes []string
	sends   []string
	history []provider.OutputEvent
}

func (d *resumeProbeDriver) ID() string         { return d.id }
func (d *resumeProbeDriver) BinaryName() string { return os.Args[0] }
func (d *resumeProbeDriver) UseLongLivedSession(config provider.SessionConfig) bool {
	return true
}
func (d *resumeProbeDriver) BinaryCandidates() []string {
	return []string{os.Args[0]}
}
func (d *resumeProbeDriver) BuildArgs(config provider.SessionConfig) []string {
	d.mu.Lock()
	d.starts = append(d.starts, config)
	if config.ResumeSessionID != "" {
		d.resumes = append(d.resumes, config.ResumeSessionID)
	}
	d.mu.Unlock()
	return []string{"-test.run=TestProjectChatProviderResumeProbeHelper", "--"}
}
func (d *resumeProbeDriver) EnvVars(config provider.SessionConfig) map[string]string {
	return map[string]string{"ROPCODE_PROJECTCHAT_RESUME_PROBE": "1"}
}
func (d *resumeProbeDriver) ParseOutput(line []byte) *provider.OutputEvent { return nil }
func (d *resumeProbeDriver) ParseStderr(line []byte) *provider.StderrEvent { return nil }
func (d *resumeProbeDriver) SendMessage(session provider.SessionHandle, msg string) error {
	d.mu.Lock()
	d.sends = append(d.sends, msg)
	d.mu.Unlock()
	return nil
}
func (d *resumeProbeDriver) Interrupt(session provider.SessionHandle) error {
	return session.Kill()
}
func (d *resumeProbeDriver) SetModel(session provider.SessionHandle, model string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) { c.Model = model })
	return nil
}
func (d *resumeProbeDriver) SetPermissionMode(session provider.SessionHandle, mode string) error {
	return nil
}
func (d *resumeProbeDriver) UpdateEnvironmentVariables(session provider.SessionHandle, vars map[string]string) error {
	return nil
}
func (d *resumeProbeDriver) WaitForInit(session provider.SessionHandle, timeout time.Duration) error {
	config := session.GetConfig()
	if config.ResumeSessionID != "" {
		session.SetProviderSessionID(config.ResumeSessionID)
	} else if session.GetProviderSessionID() == "" {
		session.SetProviderSessionID(fmt.Sprintf("%s-native-%d", d.id, len(d.starts)))
	}
	session.MarkInitialized()
	return nil
}
func (d *resumeProbeDriver) QuerySessionActivity(session provider.SessionHandle, timeout time.Duration) (*provider.SessionActivity, error) {
	return provider.DefaultSessionActivity(session), nil
}
func (d *resumeProbeDriver) OnProcessStart(_ context.Context, _ provider.SessionHandle, _ int) error {
	return nil
}
func (d *resumeProbeDriver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {}
func (d *resumeProbeDriver) LoadSessionHistory(projectID, sessionID string) ([]provider.Message, error) {
	return nil, nil
}
func (d *resumeProbeDriver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]provider.OutputEvent(nil), d.history...), nil
}
func (d *resumeProbeDriver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	return nil, nil
}
func (d *resumeProbeDriver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	return provider.HistorySessionsResult{}, nil
}
func (d *resumeProbeDriver) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	return nil, nil
}
func (d *resumeProbeDriver) GetMessagesRange(projectID, sessionID string, start, end int) ([]provider.Message, error) {
	return nil, nil
}
func (d *resumeProbeDriver) LoadSubagentTranscripts(projectID, sessionID string) (map[string][]provider.Message, error) {
	return nil, nil
}

func TestProjectChatProviderResumeProbeHelper(t *testing.T) {
	if os.Getenv("ROPCODE_PROJECTCHAT_RESUME_PROBE") != "1" {
		return
	}
	select {}
}

func TestSwitchProviderResumesExistingProviderSession(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{id: "claude"}
	codexDriver := &resumeProbeDriver{id: "codex"}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}
	if err := prov.RegisterDriver(codexDriver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)

	projectPath := t.TempDir()
	created, err := manager.CreateChat(projectPath, "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if created.RuntimeSessionID != "" {
		t.Fatalf("expected CreateChat to be lazy, got runtime %q", created.RuntimeSessionID)
	}
	initial, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get initial segment: %v", err)
	}
	if initial.RuntimeSessionID != "" || initial.ProviderSessionID != "" {
		t.Fatalf("expected initial segment to have no provider session before first send, got runtime=%q provider=%q", initial.RuntimeSessionID, initial.ProviderSessionID)
	}
	if len(claudeDriver.starts) != 0 {
		t.Fatalf("expected CreateChat not to start claude, got %d starts", len(claudeDriver.starts))
	}

	if _, err := manager.SendMessage(created.ChatID, "hello claude", "sonnet", "", ""); err != nil {
		t.Fatalf("send initial message: %v", err)
	}
	initial, err = db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("reload initial segment: %v", err)
	}
	if initial.ProviderSessionID == "" {
		t.Fatal("expected initial provider session id to be captured after first send")
	}
	created.RuntimeSessionID = initial.RuntimeSessionID

	codexSwitched, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", "")
	if err != nil {
		t.Fatalf("switch to codex: %v", err)
	}
	if codexSwitched.RuntimeSessionID != "" {
		t.Fatalf("expected switch to codex to be lazy, got runtime %q", codexSwitched.RuntimeSessionID)
	}
	if len(codexDriver.starts) != 0 {
		t.Fatalf("expected switch to codex not to start codex, got %d starts", len(codexDriver.starts))
	}
	reswitched, err := manager.SwitchProvider(created.ChatID, "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("switch back to claude: %v", err)
	}

	if reswitched.RuntimeSessionID != created.RuntimeSessionID {
		t.Fatalf("expected switch-back to reuse running claude runtime %q, got %q", created.RuntimeSessionID, reswitched.RuntimeSessionID)
	}
	if len(claudeDriver.starts) != 1 {
		t.Fatalf("expected no new claude process when switching back to a live provider session, got %d starts", len(claudeDriver.starts))
	}
	if len(claudeDriver.resumes) != 0 {
		t.Fatalf("expected no resume process while original claude session is still live, got %#v", claudeDriver.resumes)
	}
	if !prov.IsProviderSessionRunningForProject(projectPath, created.RuntimeSessionID) {
		t.Fatalf("expected original claude session to remain running after switch")
	}
	active, err := db.GetChatSegment(reswitched.SegmentID)
	if err != nil {
		t.Fatalf("get active segment: %v", err)
	}
	if active.ProviderSessionID != initial.ProviderSessionID {
		t.Fatalf("expected active segment provider session %q, got %q", initial.ProviderSessionID, active.ProviderSessionID)
	}
}

func TestSendMessageUsesProviderSessionResolver(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{id: "claude"}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	created, err := manager.CreateChat(t.TempDir(), "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}

	if _, err := manager.SendMessage(created.ChatID, "hello", "sonnet", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}

	claudeDriver.mu.Lock()
	defer claudeDriver.mu.Unlock()
	if len(claudeDriver.sends) != 1 {
		t.Fatalf("expected one provider send, got %d", len(claudeDriver.sends))
	}
	if claudeDriver.sends[0] != "hello" {
		t.Fatalf("expected provider to receive raw user message, got %q", claudeDriver.sends[0])
	}
}

func TestSendMessageResumesWrappedProviderSessionID(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{id: "claude"}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.CreateChat(projectPath, "claude", "sonnet", "", "provider-history-session")
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}

	seg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get segment: %v", err)
	}
	if seg.RuntimeSessionID != "" {
		t.Fatalf("expected wrapped historical session to have no runtime id yet, got %q", seg.RuntimeSessionID)
	}
	if seg.ProviderSessionID != "provider-history-session" {
		t.Fatalf("expected provider session id to be preserved, got %q", seg.ProviderSessionID)
	}

	if _, err := manager.SendMessage(created.ChatID, "hello from wrapped session", "sonnet", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}

	claudeDriver.mu.Lock()
	defer claudeDriver.mu.Unlock()
	if len(claudeDriver.resumes) != 1 || claudeDriver.resumes[0] != "provider-history-session" {
		t.Fatalf("expected resume with provider-history-session, got %#v", claudeDriver.resumes)
	}
	if len(claudeDriver.sends) != 1 || claudeDriver.sends[0] != "hello from wrapped session" {
		t.Fatalf("expected one resumed send with original prompt, got %#v", claudeDriver.sends)
	}
}

func TestLoadAllSegmentFramesUsesProjectChatStreamID(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{
		id: "claude",
		history: []provider.OutputEvent{
			{
				Type:              "assistant",
				SessionID:         "provider-native-session",
				Provider:          "claude",
				ProviderSessionID: "provider-native-session",
				Message: map[string]interface{}{
					"message": map[string]interface{}{
						"role": "assistant",
						"content": []interface{}{
							map[string]interface{}{
								"type": "text",
								"text": "historical reply",
							},
						},
					},
				},
			},
		},
	}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	created, err := manager.CreateChat(t.TempDir(), "claude", "sonnet", "", "provider-native-session")
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}

	frames, err := manager.LoadAllSegmentFrames(created.ChatID)
	if err != nil {
		t.Fatalf("load frames: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("expected one history frame, got %d", len(frames))
	}
	if frames[0].StreamID != created.ChatID {
		t.Fatalf("expected history frame stream %q, got %q", created.ChatID, frames[0].StreamID)
	}
	if frames[0].ProviderSessionID != "provider-native-session" {
		t.Fatalf("expected provider session id to be preserved, got %q", frames[0].ProviderSessionID)
	}
}
