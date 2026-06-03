package notifications

import (
	"path/filepath"
	"testing"

	"ropcode/internal/database"
)

type recordingSender struct {
	events []SessionFinished
}

func (s *recordingSender) Send(event SessionFinished) error {
	s.events = append(s.events, event)
	return nil
}

func TestServiceSkipsSessionFinishedWhenSettingDisabled(t *testing.T) {
	db := openTestDB(t)
	sender := &recordingSender{}
	service := NewService(db, sender)

	if err := service.NotifySessionFinished(SessionFinished{
		Provider: "claude",
		Status:   "completed",
		Cwd:      filepath.Join("tmp", "project"),
	}); err != nil {
		t.Fatalf("NotifySessionFinished failed: %v", err)
	}

	if len(sender.events) != 0 {
		t.Fatalf("expected no notification when setting is disabled, got %#v", sender.events)
	}
}

func TestServiceSendsSessionFinishedWhenSettingEnabled(t *testing.T) {
	db := openTestDB(t)
	if err := db.SaveSetting(SessionFinishedEnabledKey, "true"); err != nil {
		t.Fatalf("SaveSetting failed: %v", err)
	}
	sender := &recordingSender{}
	service := NewService(db, sender)

	if err := service.NotifySessionFinished(SessionFinished{
		Provider: "codex",
		Status:   "failed",
		Cwd:      filepath.Join("tmp", "project"),
	}); err != nil {
		t.Fatalf("NotifySessionFinished failed: %v", err)
	}

	if len(sender.events) != 1 {
		t.Fatalf("expected one notification, got %#v", sender.events)
	}
	if sender.events[0].Provider != "codex" || sender.events[0].Status != "failed" {
		t.Fatalf("unexpected notification payload: %#v", sender.events[0])
	}
}

func TestSessionFinishedFromClaudeCompletePayload(t *testing.T) {
	event, ok := SessionFinishedFromPayload(map[string]any{
		"provider": "gemini",
		"status":   "cancelled",
		"cwd":      filepath.Join("tmp", "workspace"),
	})

	if !ok {
		t.Fatal("expected payload to parse")
	}
	if event.Provider != "gemini" || event.Status != "cancelled" || event.Cwd == "" {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestSessionFinishedFromExitCodePayload(t *testing.T) {
	event, ok := SessionFinishedFromPayload(map[string]any{
		"provider":  "codex",
		"exit_code": 1,
	})

	if !ok {
		t.Fatal("expected payload to parse")
	}
	if event.Status != "failed" {
		t.Fatalf("expected failed status, got %#v", event)
	}
}

func TestSessionFinishedFromJSONPayload(t *testing.T) {
	event, ok := SessionFinishedFromPayload(`{"provider":"claude","status":"completed","cwd":"E:\\repo"}`)

	if !ok {
		t.Fatal("expected JSON payload to parse")
	}
	if event.Provider != "claude" || event.Status != "completed" || event.Cwd != `E:\repo` {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func openTestDB(t *testing.T) *database.Database {
	t.Helper()
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
