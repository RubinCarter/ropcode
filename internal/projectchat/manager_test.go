package projectchat

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/provider"
)

type testEmitter struct{}

func (e *testEmitter) Emit(name string, data interface{}) {}

type resumeProbeDriver struct {
	id               string
	mu               sync.Mutex
	starts           []provider.SessionConfig
	resumes          []string
	sends            []string
	handledCommands  []string
	providerCommands map[string]struct{}
	interrupts       int
	history          []provider.OutputEvent
	capabilities     []provider.Capability
	nextNativeID     int
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
func (d *resumeProbeDriver) IsProviderCommand(message string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.providerCommands) == 0 {
		return false
	}
	_, ok := d.providerCommands[message]
	return ok
}
func (d *resumeProbeDriver) HandleProviderCommand(session provider.SessionHandle, message string) error {
	d.mu.Lock()
	d.handledCommands = append(d.handledCommands, message)
	d.mu.Unlock()
	return nil
}
func (d *resumeProbeDriver) Interrupt(session provider.SessionHandle) error {
	d.mu.Lock()
	d.interrupts++
	d.mu.Unlock()
	return nil
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
		d.mu.Lock()
		d.nextNativeID++
		nativeID := d.nextNativeID
		d.mu.Unlock()
		session.SetProviderSessionID(fmt.Sprintf("%s-native-%d", d.id, nativeID))
	}
	session.MarkInitialized()
	return nil
}
func (d *resumeProbeDriver) QuerySessionActivity(session provider.SessionHandle, timeout time.Duration) (*provider.SessionActivity, error) {
	return provider.DefaultSessionActivity(session), nil
}
func (d *resumeProbeDriver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	capabilities := append([]provider.Capability(nil), d.capabilities...)
	return provider.NormalizeCapabilityLayers(d.id, capabilities), nil
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
	created, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", true)
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

func TestEnsureChatReusesActiveProjectChat(t *testing.T) {
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

	first, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", false)
	if err != nil {
		t.Fatalf("ensure first chat: %v", err)
	}
	second, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", false)
	if err != nil {
		t.Fatalf("ensure second chat: %v", err)
	}

	if second.ChatID != first.ChatID {
		t.Fatalf("expected empty active chat to be reused, first=%s second=%s", first.ChatID, second.ChatID)
	}
	if second.SegmentID != first.SegmentID {
		t.Fatalf("expected initial segment to be reused, first=%s second=%s", first.SegmentID, second.SegmentID)
	}
	chats, err := db.ListProjectChats(projectPath)
	if err != nil {
		t.Fatalf("list chats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("expected one project chat, got %d", len(chats))
	}

	if _, err := manager.SendMessage(first.ChatID, "hello", "sonnet", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}
	third, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", false)
	if err != nil {
		t.Fatalf("ensure third chat: %v", err)
	}
	if third.ChatID != first.ChatID {
		t.Fatalf("expected non-empty active chat to remain the backend-owned project chat")
	}

	forced, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", true)
	if err != nil {
		t.Fatalf("force new chat: %v", err)
	}
	if forced.ChatID == first.ChatID {
		t.Fatalf("expected forceNew to create a new project chat")
	}
}

func TestEnsureChatDoesNotSwitchActiveProviderWithoutHistoricalSession(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)
	for _, id := range []string{"claude", "codex"} {
		if err := prov.RegisterDriver(&resumeProbeDriver{id: id}); err != nil {
			t.Fatalf("register %s: %v", id, err)
		}
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()

	codexChat, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "", true)
	if err != nil {
		t.Fatalf("create codex chat: %v", err)
	}

	restored, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", false)
	if err != nil {
		t.Fatalf("ensure active chat with default claude provider: %v", err)
	}
	if restored.ChatID != codexChat.ChatID {
		t.Fatalf("expected active codex chat %s, got %s", codexChat.ChatID, restored.ChatID)
	}
	if restored.Provider != "codex" {
		t.Fatalf("expected ensure without historical session to preserve codex, got %q", restored.Provider)
	}
	if restored.SegmentID != codexChat.SegmentID {
		t.Fatalf("expected active segment %s, got %s", codexChat.SegmentID, restored.SegmentID)
	}

	active, err := db.GetProjectChat(codexChat.ChatID)
	if err != nil {
		t.Fatalf("get active chat: %v", err)
	}
	if active.ActiveProvider != "codex" || active.ActiveSegmentID != codexChat.SegmentID {
		t.Fatalf("expected database to keep active codex segment, got provider=%q segment=%q", active.ActiveProvider, active.ActiveSegmentID)
	}

	segments, err := db.ListChatSegments(codexChat.ChatID)
	if err != nil {
		t.Fatalf("list segments: %v", err)
	}
	if len(segments) != 1 {
		t.Fatalf("expected no implicit provider switch segment, got %d segments", len(segments))
	}
}

func TestEnsureChatPrefersExistingProviderSessionOverActiveProjectChat(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)
	for _, id := range []string{"claude", "codex"} {
		if err := prov.RegisterDriver(&resumeProbeDriver{id: id}); err != nil {
			t.Fatalf("register %s: %v", id, err)
		}
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()

	codexChat, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "codex-history-session", true)
	if err != nil {
		t.Fatalf("create codex history chat: %v", err)
	}
	claudeChat, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "claude-history-session", true)
	if err != nil {
		t.Fatalf("create newer claude chat: %v", err)
	}
	if claudeChat.ChatID == codexChat.ChatID {
		t.Fatalf("expected distinct chats")
	}

	restored, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "codex-history-session", false)
	if err != nil {
		t.Fatalf("restore codex chat: %v", err)
	}
	if restored.ChatID != codexChat.ChatID {
		t.Fatalf("expected codex history chat %s, got %s", codexChat.ChatID, restored.ChatID)
	}
	if restored.SegmentID != codexChat.SegmentID {
		t.Fatalf("expected codex segment %s, got %s", codexChat.SegmentID, restored.SegmentID)
	}
	if restored.Provider != "codex" {
		t.Fatalf("expected restored provider codex, got %q", restored.Provider)
	}

	active, err := db.GetProjectChat(codexChat.ChatID)
	if err != nil {
		t.Fatalf("get restored chat: %v", err)
	}
	if active.ActiveProvider != "codex" || active.ActiveSegmentID != codexChat.SegmentID {
		t.Fatalf("expected restored chat active codex segment, got provider=%q segment=%q", active.ActiveProvider, active.ActiveSegmentID)
	}
}

func TestEnsureChatRestoresExistingProviderSessionSegmentWithoutCreatingNewSegment(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)
	for _, id := range []string{"claude", "codex"} {
		if err := prov.RegisterDriver(&resumeProbeDriver{id: id}); err != nil {
			t.Fatalf("register %s: %v", id, err)
		}
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()

	codexChat, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "codex-history-session", true)
	if err != nil {
		t.Fatalf("create codex history chat: %v", err)
	}
	claudeSegment, err := manager.SwitchProvider(codexChat.ChatID, "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("switch to claude: %v", err)
	}

	codexBeforeRestore, err := db.GetChatSegment(codexChat.SegmentID)
	if err != nil {
		t.Fatalf("get codex segment before restore: %v", err)
	}
	if codexBeforeRestore.Status != database.SegmentStatusInterrupted {
		t.Fatalf("expected codex segment to be interrupted after provider switch, got %q", codexBeforeRestore.Status)
	}

	restored, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "codex-history-session", false)
	if err != nil {
		t.Fatalf("restore codex history chat: %v", err)
	}
	if restored.ChatID != codexChat.ChatID {
		t.Fatalf("expected same project chat %s, got %s", codexChat.ChatID, restored.ChatID)
	}
	if restored.SegmentID != codexChat.SegmentID {
		t.Fatalf("expected existing codex segment %s, got %s", codexChat.SegmentID, restored.SegmentID)
	}

	segments, err := db.ListChatSegments(codexChat.ChatID)
	if err != nil {
		t.Fatalf("list segments: %v", err)
	}
	if len(segments) != 2 {
		t.Fatalf("expected no new segment on provider session restore, got %d segments", len(segments))
	}

	codexAfterRestore, err := db.GetChatSegment(codexChat.SegmentID)
	if err != nil {
		t.Fatalf("get codex segment after restore: %v", err)
	}
	if codexAfterRestore.Status != database.SegmentStatusActive || codexAfterRestore.CompletedAt != nil {
		t.Fatalf("expected restored codex segment active with no completion timestamp, got status=%q completed=%v", codexAfterRestore.Status, codexAfterRestore.CompletedAt)
	}
	if codexAfterRestore.ProviderSessionID != "codex-history-session" {
		t.Fatalf("expected provider session id to be preserved, got %q", codexAfterRestore.ProviderSessionID)
	}

	claudeAfterRestore, err := db.GetChatSegment(claudeSegment.SegmentID)
	if err != nil {
		t.Fatalf("get claude segment after restore: %v", err)
	}
	if claudeAfterRestore.Status != database.SegmentStatusInterrupted {
		t.Fatalf("expected previous claude segment to be interrupted, got %q", claudeAfterRestore.Status)
	}

	active, err := db.GetProjectChat(codexChat.ChatID)
	if err != nil {
		t.Fatalf("get active chat: %v", err)
	}
	if active.ActiveProvider != "codex" || active.ActiveSegmentID != codexChat.SegmentID {
		t.Fatalf("expected active codex segment, got provider=%q segment=%q", active.ActiveProvider, active.ActiveSegmentID)
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
	created, err := manager.EnsureChat(t.TempDir(), "claude", "sonnet", "", "", true)
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

func TestClearChatKeepsProjectChatAndStartsEmptyActiveSegment(t *testing.T) {
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
	created, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "send claude", "sonnet", "", ""); err != nil {
		t.Fatalf("send claude: %v", err)
	}
	claudeSeg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get claude segment: %v", err)
	}

	switched, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", "")
	if err != nil {
		t.Fatalf("choose codex: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "send codex", "gpt-5", "", ""); err != nil {
		t.Fatalf("send codex: %v", err)
	}
	codexSeg, err := db.GetChatSegment(switched.SegmentID)
	if err != nil {
		t.Fatalf("get codex segment: %v", err)
	}
	if codexSeg.ProviderSessionID == "" {
		t.Fatal("expected codex provider session before clear")
	}

	cleared, err := manager.ClearChat(created.ChatID)
	if err != nil {
		t.Fatalf("clear chat: %v", err)
	}
	if cleared.ChatID != created.ChatID {
		t.Fatalf("expected project chat id to stay %q, got %q", created.ChatID, cleared.ChatID)
	}
	if cleared.Provider != "codex" {
		t.Fatalf("expected clear to keep active provider codex, got %q", cleared.Provider)
	}
	if cleared.RuntimeSessionID != "" {
		t.Fatalf("expected clear segment to be runtime-empty, got %q", cleared.RuntimeSessionID)
	}

	chat, err := db.GetProjectChat(created.ChatID)
	if err != nil {
		t.Fatalf("get chat after clear: %v", err)
	}
	if chat.ActiveSegmentID != cleared.SegmentID {
		t.Fatalf("expected active segment %q, got %q", cleared.SegmentID, chat.ActiveSegmentID)
	}
	clearSeg, err := db.GetChatSegment(cleared.SegmentID)
	if err != nil {
		t.Fatalf("get clear segment: %v", err)
	}
	if clearSeg.Provider != "codex" || clearSeg.Status != database.SegmentStatusActive {
		t.Fatalf("expected active codex clear segment, got provider=%q status=%q", clearSeg.Provider, clearSeg.Status)
	}
	if clearSeg.RuntimeSessionID != "" || clearSeg.ProviderSessionID != provider.FreshSessionSentinel {
		t.Fatalf("expected clear segment to be runtime-empty and marked fresh, got runtime=%q provider=%q", clearSeg.RuntimeSessionID, clearSeg.ProviderSessionID)
	}

	reloadedClaudeSeg, err := db.GetChatSegment(claudeSeg.ID)
	if err != nil {
		t.Fatalf("reload claude segment: %v", err)
	}
	if reloadedClaudeSeg.Status != database.SegmentStatusInterrupted {
		t.Fatalf("expected claude segment to stay interrupted, got %q", reloadedClaudeSeg.Status)
	}
	reloadedCodexSeg, err := db.GetChatSegment(codexSeg.ID)
	if err != nil {
		t.Fatalf("reload codex segment: %v", err)
	}
	if reloadedCodexSeg.Status != database.SegmentStatusInterrupted {
		t.Fatalf("expected pre-clear codex segment interrupted, got %q", reloadedCodexSeg.Status)
	}

	if _, err := manager.SendMessage(created.ChatID, "send codex after clear", "gpt-5", "", ""); err != nil {
		t.Fatalf("send codex after clear: %v", err)
	}
	clearSeg, err = db.GetChatSegment(cleared.SegmentID)
	if err != nil {
		t.Fatalf("reload clear segment after send: %v", err)
	}
	if clearSeg.ProviderSessionID == "" {
		t.Fatal("expected post-clear codex send to create a provider session")
	}
	if clearSeg.ProviderSessionID == provider.FreshSessionSentinel {
		t.Fatal("expected post-clear codex send to replace the fresh-session sentinel")
	}
	if clearSeg.ProviderSessionID == codexSeg.ProviderSessionID {
		t.Fatalf("expected post-clear codex session not to reuse %q", codexSeg.ProviderSessionID)
	}

	codexDriver.mu.Lock()
	starts := len(codexDriver.starts)
	resumes := append([]string(nil), codexDriver.resumes...)
	codexDriver.mu.Unlock()
	if starts != 2 {
		t.Fatalf("expected codex to start once before clear and once after clear, got %d", starts)
	}
	if len(resumes) != 0 {
		t.Fatalf("expected post-clear codex not to resume old session, got %#v", resumes)
	}

	sameProvider, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", "")
	if err != nil {
		t.Fatalf("choose codex while already on codex: %v", err)
	}
	if sameProvider.SegmentID != cleared.SegmentID {
		t.Fatalf("expected same-provider switch to keep clear segment %q, got %q", cleared.SegmentID, sameProvider.SegmentID)
	}
}

func TestSendMessageProviderCommandDoesNotConsumePendingContext(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{id: "claude"}
	codexDriver := &resumeProbeDriver{
		id:               "codex",
		providerCommands: map[string]struct{}{"/compact": {}},
	}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}
	if err := prov.RegisterDriver(codexDriver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "hello", "sonnet", "", ""); err != nil {
		t.Fatalf("send initial message: %v", err)
	}

	initial, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get initial segment: %v", err)
	}
	claudeDriver.mu.Lock()
	claudeDriver.history = []provider.OutputEvent{
		userHistoryEvent("claude", initial.ProviderSessionID, "hello"),
		assistantHistoryEvent("claude", initial.ProviderSessionID, "initial reply"),
	}
	claudeDriver.mu.Unlock()

	switched, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", "")
	if err != nil {
		t.Fatalf("switch provider: %v", err)
	}
	codexSeg, err := db.GetChatSegment(switched.SegmentID)
	if err != nil {
		t.Fatalf("get codex segment: %v", err)
	}
	if !codexSeg.ContextInjected {
		t.Fatal("expected switched segment to have pending context")
	}

	if _, err := manager.SendMessage(created.ChatID, "/compact", "gpt-5", "", ""); err != nil {
		t.Fatalf("send provider command: %v", err)
	}
	codexDriver.mu.Lock()
	if len(codexDriver.handledCommands) != 1 || codexDriver.handledCommands[0] != "/compact" {
		t.Fatalf("expected provider command handler to receive /compact, got %#v", codexDriver.handledCommands)
	}
	if len(codexDriver.sends) != 0 {
		t.Fatalf("expected provider command not to be sent as prompt, got %#v", codexDriver.sends)
	}
	codexDriver.mu.Unlock()

	codexSeg, err = db.GetChatSegment(switched.SegmentID)
	if err != nil {
		t.Fatalf("reload codex segment: %v", err)
	}
	if !codexSeg.ContextInjected {
		t.Fatal("expected provider command not to consume pending context")
	}

	if _, err := manager.SendMessage(created.ChatID, "continue", "gpt-5", "", ""); err != nil {
		t.Fatalf("send regular message: %v", err)
	}
	codexDriver.mu.Lock()
	defer codexDriver.mu.Unlock()
	if len(codexDriver.sends) != 1 {
		t.Fatalf("expected one regular send, got %#v", codexDriver.sends)
	}
	if !strings.Contains(codexDriver.sends[0], "<previous_conversation>") {
		t.Fatalf("expected regular send to include pending context, got %q", codexDriver.sends[0])
	}
	if !strings.Contains(codexDriver.sends[0], "[Assistant]: initial reply") {
		t.Fatalf("expected pending context to include previous assistant reply, got %q", codexDriver.sends[0])
	}
}

func TestSendMessageExpandsProviderCapabilityBeforeContextInjection(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	claudeDriver := &resumeProbeDriver{id: "claude"}
	codexDriver := &resumeProbeDriver{
		id: "codex",
		capabilities: []provider.Capability{
			{
				Provider:    "codex",
				Name:        "commit-as-prompt",
				SlashName:   "/commit-as-prompt",
				Kind:        string(provider.CapabilityKindCommand),
				Scope:       string(provider.CapabilityScopeUser),
				Content:     "Commit the following change:\n\n$ARGUMENTS",
				Description: "Commit staged changes",
			},
		},
	}
	if err := prov.RegisterDriver(claudeDriver); err != nil {
		t.Fatalf("register claude: %v", err)
	}
	if err := prov.RegisterDriver(codexDriver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "hello", "sonnet", "", ""); err != nil {
		t.Fatalf("send initial message: %v", err)
	}

	initial, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get initial segment: %v", err)
	}
	claudeDriver.mu.Lock()
	claudeDriver.history = []provider.OutputEvent{
		userHistoryEvent("claude", initial.ProviderSessionID, "hello"),
		assistantHistoryEvent("claude", initial.ProviderSessionID, "initial reply"),
	}
	claudeDriver.mu.Unlock()

	if _, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", ""); err != nil {
		t.Fatalf("switch provider: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "/commit-as-prompt ship staged files", "gpt-5", "", ""); err != nil {
		t.Fatalf("send capability invocation: %v", err)
	}

	codexDriver.mu.Lock()
	defer codexDriver.mu.Unlock()
	if len(codexDriver.sends) != 1 {
		t.Fatalf("expected one codex send, got %#v", codexDriver.sends)
	}
	got := codexDriver.sends[0]
	if !strings.Contains(got, "<previous_conversation>") {
		t.Fatalf("expected provider context to be injected, got %q", got)
	}
	if !strings.Contains(got, "[Assistant]: initial reply") {
		t.Fatalf("expected previous assistant reply in context, got %q", got)
	}
	if !strings.Contains(got, "Commit the following change:\n\nship staged files") {
		t.Fatalf("expected capability prompt expansion, got %q", got)
	}
	if strings.Contains(got, "/commit-as-prompt") {
		t.Fatalf("expected raw slash invocation to be removed, got %q", got)
	}
}

func TestInterruptActiveSegmentUsesProviderInterrupt(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	driver := &resumeProbeDriver{id: "codex"}
	if err := prov.RegisterDriver(driver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if _, err := manager.SendMessage(created.ChatID, "start work", "gpt-5", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}
	seg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get segment: %v", err)
	}
	if seg.RuntimeSessionID == "" {
		t.Fatal("expected runtime session after send")
	}

	if err := manager.InterruptActiveSegment(created.ChatID); err != nil {
		t.Fatalf("interrupt active segment: %v", err)
	}

	driver.mu.Lock()
	interrupts := driver.interrupts
	driver.mu.Unlock()
	if interrupts != 1 {
		t.Fatalf("expected one provider interrupt, got %d", interrupts)
	}
	if !prov.IsProviderSessionRunningForProject(projectPath, seg.RuntimeSessionID) {
		t.Fatalf("expected provider runtime to remain alive after interrupt")
	}
}

func userHistoryEvent(providerID, sessionID, text string) provider.OutputEvent {
	return provider.OutputEvent{
		Type:              "user",
		Provider:          providerID,
		ProviderSessionID: sessionID,
		SessionID:         sessionID,
		Message: map[string]interface{}{
			"session_id": sessionID,
			"message": map[string]interface{}{
				"role": "user",
				"content": []interface{}{
					map[string]interface{}{"type": "text", "text": text},
				},
			},
		},
	}
}

func assistantHistoryEvent(providerID, sessionID, text string) provider.OutputEvent {
	return provider.OutputEvent{
		Type:              "assistant",
		Provider:          providerID,
		ProviderSessionID: sessionID,
		SessionID:         sessionID,
		Message: map[string]interface{}{
			"session_id": sessionID,
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []interface{}{
					map[string]interface{}{"type": "text", "text": text},
				},
			},
		},
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
	created, err := manager.EnsureChat(projectPath, "claude", "sonnet", "", "provider-history-session", true)
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

func TestSendMessagePrefersProviderSessionIDOverStaleRuntimeSessionID(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	codexDriver := &resumeProbeDriver{id: "codex"}
	if err := prov.RegisterDriver(codexDriver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "provider-history-session", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	if err := db.UpdateChatSegmentRuntime(created.SegmentID, "stale-runtime-session", "provider-history-session"); err != nil {
		t.Fatalf("set stale runtime id: %v", err)
	}

	if _, err := manager.SendMessage(created.ChatID, "resume from provider id", "gpt-5", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}

	codexDriver.mu.Lock()
	resumes := append([]string(nil), codexDriver.resumes...)
	sends := append([]string(nil), codexDriver.sends...)
	codexDriver.mu.Unlock()

	if len(resumes) != 1 || resumes[0] != "provider-history-session" {
		t.Fatalf("expected resume with provider-history-session, got %#v", resumes)
	}
	if len(sends) != 1 || sends[0] != "resume from provider id" {
		t.Fatalf("expected one send with original prompt, got %#v", sends)
	}

	seg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get segment: %v", err)
	}
	if seg.RuntimeSessionID == "" || seg.RuntimeSessionID == "stale-runtime-session" {
		t.Fatalf("expected stale runtime id to be replaced, got %q", seg.RuntimeSessionID)
	}
	if seg.ProviderSessionID != "provider-history-session" {
		t.Fatalf("expected provider session id to remain stable, got %q", seg.ProviderSessionID)
	}
}

func TestSendMessageRepairsTerminalActiveSegmentBeforeDispatch(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)
	for _, id := range []string{"claude", "codex"} {
		if err := prov.RegisterDriver(&resumeProbeDriver{id: id}); err != nil {
			t.Fatalf("register %s: %v", id, err)
		}
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	projectPath := t.TempDir()
	created, err := manager.EnsureChat(projectPath, "codex", "gpt-5", "", "provider-history-session", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	staleClaude, err := manager.SwitchProvider(created.ChatID, "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("switch to claude: %v", err)
	}

	completedAt := time.Now().Unix()
	if err := db.UpdateChatSegmentStatus(created.SegmentID, database.SegmentStatusCompleted, &completedAt); err != nil {
		t.Fatalf("mark codex terminal: %v", err)
	}
	if err := db.UpdateProjectChatActive(created.ChatID, "codex", created.SegmentID); err != nil {
		t.Fatalf("point project chat at codex segment: %v", err)
	}
	if err := db.UpdateChatSegmentStatus(created.SegmentID, database.SegmentStatusCompleted, &completedAt); err != nil {
		t.Fatalf("simulate terminal active pointer: %v", err)
	}
	if err := db.UpdateChatSegmentStatus(staleClaude.SegmentID, database.SegmentStatusActive, nil); err != nil {
		t.Fatalf("simulate stale active claude segment: %v", err)
	}

	if _, err := manager.SendMessage(created.ChatID, "send after repair", "gpt-5", "", ""); err != nil {
		t.Fatalf("send message: %v", err)
	}

	codexSeg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get codex segment: %v", err)
	}
	if codexSeg.Status != database.SegmentStatusActive || codexSeg.CompletedAt != nil {
		t.Fatalf("expected codex segment repaired to active, got status=%q completed=%v", codexSeg.Status, codexSeg.CompletedAt)
	}
	claudeSeg, err := db.GetChatSegment(staleClaude.SegmentID)
	if err != nil {
		t.Fatalf("get claude segment: %v", err)
	}
	if claudeSeg.Status != database.SegmentStatusInterrupted {
		t.Fatalf("expected stale claude active segment to be interrupted, got %q", claudeSeg.Status)
	}

	chat, err := db.GetProjectChat(created.ChatID)
	if err != nil {
		t.Fatalf("get chat: %v", err)
	}
	if chat.ActiveProvider != "codex" || chat.ActiveSegmentID != created.SegmentID {
		t.Fatalf("expected active codex segment after repair, got provider=%q segment=%q", chat.ActiveProvider, chat.ActiveSegmentID)
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
	created, err := manager.EnsureChat(t.TempDir(), "claude", "sonnet", "", "provider-native-session", true)
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

func TestLoadAllSegmentFramesUsesProviderSessionIDForHistoryOnlySegment(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	prov := provider.NewManager(context.Background(), &testEmitter{}, nil)
	t.Cleanup(prov.Shutdown)

	driver := &resumeProbeDriver{
		id: "codex",
		history: []provider.OutputEvent{
			{
				Type:              "assistant",
				Provider:          "codex",
				ProviderSessionID: "provider-history-session",
				Message: map[string]interface{}{
					"message": map[string]interface{}{
						"role": "assistant",
						"content": []interface{}{
							map[string]interface{}{
								"type": "text",
								"text": "historical codex reply",
							},
						},
					},
				},
			},
		},
	}
	if err := prov.RegisterDriver(driver); err != nil {
		t.Fatalf("register codex: %v", err)
	}

	manager := NewManager(db, prov, &testEmitter{}, nil)
	created, err := manager.EnsureChat(t.TempDir(), "codex", "gpt-5", "", "provider-history-session", true)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}

	seg, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get segment: %v", err)
	}
	if seg.RuntimeSessionID != "" {
		t.Fatalf("expected no runtime id for wrapped historical segment, got %q", seg.RuntimeSessionID)
	}
	if seg.ProviderSessionID != "provider-history-session" {
		t.Fatalf("expected provider session id to be stored, got %q", seg.ProviderSessionID)
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
	if frames[0].RuntimeSessionID != "provider-history-session" {
		t.Fatalf("expected provider session id as history runtime identity, got %q", frames[0].RuntimeSessionID)
	}
	if frames[0].ProviderSessionID != "provider-history-session" {
		t.Fatalf("expected provider session id to be preserved, got %q", frames[0].ProviderSessionID)
	}
	if got := frames[0].Content[0].Text; got != "historical codex reply" {
		t.Fatalf("expected historical assistant text, got %q", got)
	}
}
