package main

import (
	"path/filepath"
	"testing"

	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/notifications"
)

func TestProviderStreamEmitterNotifiesOnClaudeCompleteWhenEnabled(t *testing.T) {
	db, sender := testNotificationDBAndSender(t)
	if err := db.SaveSetting(notifications.SessionFinishedEnabledKey, "true"); err != nil {
		t.Fatalf("SaveSetting failed: %v", err)
	}
	emitter := &providerStreamEmitter{
		eventHub:      eventhub.New(nil),
		notifications: notifications.NewService(db, sender),
	}

	emitter.Emit("claude-complete", map[string]any{
		"provider": "claude",
		"status":   "completed",
		"cwd":      filepath.Join("tmp", "repo"),
	})

	if len(sender.events) != 1 {
		t.Fatalf("expected one notification, got %#v", sender.events)
	}
	if sender.events[0].Provider != "claude" || sender.events[0].Status != "completed" {
		t.Fatalf("unexpected notification: %#v", sender.events[0])
	}
}

type testNotificationSender struct {
	events []notifications.SessionFinished
}

func (s *testNotificationSender) Send(event notifications.SessionFinished) error {
	s.events = append(s.events, event)
	return nil
}

func testNotificationDBAndSender(t *testing.T) (*database.Database, *testNotificationSender) {
	t.Helper()
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, &testNotificationSender{}
}
