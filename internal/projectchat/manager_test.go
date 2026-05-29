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
}

func (d *resumeProbeDriver) ID() string         { return d.id }
func (d *resumeProbeDriver) BinaryName() string { return os.Args[0] }
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
func (d *resumeProbeDriver) OnProcessStart(_ context.Context, _ provider.SessionHandle, _ int) error {
	return nil
}
func (d *resumeProbeDriver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {}

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

	created, err := manager.CreateChat(t.TempDir(), "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	initial, err := db.GetChatSegment(created.SegmentID)
	if err != nil {
		t.Fatalf("get initial segment: %v", err)
	}
	if initial.ProviderSessionID == "" {
		t.Fatal("expected initial provider session id to be captured")
	}

	if _, err := manager.SwitchProvider(created.ChatID, "codex", "gpt-5", ""); err != nil {
		t.Fatalf("switch to codex: %v", err)
	}
	reswitched, err := manager.SwitchProvider(created.ChatID, "claude", "sonnet", "")
	if err != nil {
		t.Fatalf("switch back to claude: %v", err)
	}

	if len(claudeDriver.resumes) == 0 {
		t.Fatalf("expected claude switch-back to resume provider session %q", initial.ProviderSessionID)
	}
	if got := claudeDriver.resumes[len(claudeDriver.resumes)-1]; got != initial.ProviderSessionID {
		t.Fatalf("expected resume id %q, got %q", initial.ProviderSessionID, got)
	}

	active, err := db.GetChatSegment(reswitched.SegmentID)
	if err != nil {
		t.Fatalf("get active segment: %v", err)
	}
	if active.ProviderSessionID != initial.ProviderSessionID {
		t.Fatalf("expected active segment provider session %q, got %q", initial.ProviderSessionID, active.ProviderSessionID)
	}
}
