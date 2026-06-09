package eventhub

import (
	"context"
	"testing"
	"time"

	"ropcode/internal/stream"
)

func TestEmitSessionChangedBroadcastsSyncEvent(t *testing.T) {
	hub := New(context.Background())
	syncHub := stream.NewSyncHub()
	sub := syncHub.Subscribe()
	defer sub.Close()

	hub.SetSyncHub(syncHub)
	hub.EmitSessionChanged(SessionChangedEvent{
		ID:       "session-1",
		Cwd:      `D:\bit_master\go-serial-cli`,
		State:    "active",
		Provider: "claude",
	})

	select {
	case event := <-sub.C:
		if event.Type != "session:changed" {
			t.Fatalf("type = %q, want session:changed", event.Type)
		}
		if event.WorkspacePath != `D:\bit_master\go-serial-cli` {
			t.Fatalf("workspace path = %q", event.WorkspacePath)
		}
		if event.SessionID != "session-1" {
			t.Fatalf("session id = %q", event.SessionID)
		}
		if event.Provider != "claude" {
			t.Fatalf("provider = %q", event.Provider)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for sync event")
	}
}

func TestEmitProjectChangedBroadcastsSyncEvent(t *testing.T) {
	hub := New(context.Background())
	syncHub := stream.NewSyncHub()
	sub := syncHub.Subscribe()
	defer sub.Close()

	hub.SetSyncHub(syncHub)
	hub.EmitProjectChanged(ProjectChangedEvent{
		ProjectPath:   `D:\bit_master\go-serial-cli`,
		WorkspacePath: `D:\bit_master\go-serial-cli`,
		Reason:        "test",
		Timestamp:     time.Now(),
	})

	select {
	case event := <-sub.C:
		if event.Type != "project:changed" {
			t.Fatalf("type = %q, want project:changed", event.Type)
		}
		if event.ProjectPath != `D:\bit_master\go-serial-cli` {
			t.Fatalf("project path = %q", event.ProjectPath)
		}
		if event.WorkspacePath != `D:\bit_master\go-serial-cli` {
			t.Fatalf("workspace path = %q", event.WorkspacePath)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for sync event")
	}
}
