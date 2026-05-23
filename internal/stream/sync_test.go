package stream

import (
	"testing"
	"time"
)

func TestSyncHubBroadcastsSmallInvalidationEvents(t *testing.T) {
	hub := NewSyncHub()
	subA := hub.Subscribe()
	defer subA.Close()
	subB := hub.Subscribe()
	defer subB.Close()

	event := SyncEvent{
		Type:      "project:changed",
		ProjectID: "project-1",
		Summary:   map[string]any{"workspaceCount": 3},
	}
	hub.Broadcast(event)

	if got := receiveSyncEvent(t, subA); got.Type != event.Type || got.ProjectID != event.ProjectID {
		t.Fatalf("subscriber A got %#v", got)
	}
	if got := receiveSyncEvent(t, subB); got.Type != event.Type || got.ProjectID != event.ProjectID {
		t.Fatalf("subscriber B got %#v", got)
	}
}

func TestSyncHubCloseCleanup(t *testing.T) {
	hub := NewSyncHub()
	sub := hub.Subscribe()

	if got := hub.Diagnostics().Subscribers; got != 1 {
		t.Fatalf("expected 1 subscriber, got %d", got)
	}
	sub.Close()
	if got := hub.Diagnostics().Subscribers; got != 0 {
		t.Fatalf("expected 0 subscribers, got %d", got)
	}
}

func receiveSyncEvent(t *testing.T, sub *SyncSubscription) SyncEvent {
	t.Helper()
	select {
	case event, ok := <-sub.C:
		if !ok {
			t.Fatal("sync subscription channel closed")
		}
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for sync event")
		return SyncEvent{}
	}
}
