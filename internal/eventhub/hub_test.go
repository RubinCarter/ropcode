package eventhub

import (
	"context"
	"testing"
	"time"

	"ropcode/internal/stream"
)

type recordedBroadcast struct {
	eventType string
	payload   any
}

type recordingBroadcaster struct {
	events []recordedBroadcast
}

func (b *recordingBroadcaster) BroadcastEvent(eventType string, payload interface{}) {
	b.events = append(b.events, recordedBroadcast{eventType: eventType, payload: payload})
}

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

func TestEmitProcessChangedDerivesDomainEventFromJSONPayload(t *testing.T) {
	hub := New(context.Background())
	sub := hub.SubscribeDomain()
	defer sub.Close()

	hub.Emit("process:changed", `{"pid":321,"cwd":"D:\\repo","state":"running","provider_id":"claude","session_id":"runtime-1"}`)

	event := waitDomainEvent(t, sub)
	if event.Type != "process.started" {
		t.Fatalf("domain type = %q, want process.started", event.Type)
	}
	if event.Cause == nil || event.Cause.EventType != "process:changed" || event.Cause.Reason != "running" {
		t.Fatalf("unexpected cause: %#v", event.Cause)
	}
	if event.Scope.WorkspacePath != `D:\repo` {
		t.Fatalf("workspace path = %q", event.Scope.WorkspacePath)
	}
	if event.Scope.Provider != "claude" {
		t.Fatalf("provider = %q", event.Scope.Provider)
	}
	if event.Scope.SessionID != "runtime-1" {
		t.Fatalf("session id = %q", event.Scope.SessionID)
	}
	if event.Scope.PID != 321 {
		t.Fatalf("pid = %d", event.Scope.PID)
	}
}

func TestEmitSessionChangedDerivesDomainEventFromMapPayload(t *testing.T) {
	hub := New(context.Background())
	sub := hub.SubscribeDomain()
	defer sub.Close()

	hub.Emit("session:changed", map[string]any{
		"session_id":     "runtime-2",
		"workspace_path": `D:\repo`,
		"provider_id":    "codex",
		"state":          "completed",
	})

	event := waitDomainEvent(t, sub)
	if event.Type != "session.completed" {
		t.Fatalf("domain type = %q, want session.completed", event.Type)
	}
	if event.Cause == nil || event.Cause.EventType != "session:changed" || event.Cause.Reason != "completed" {
		t.Fatalf("unexpected cause: %#v", event.Cause)
	}
	if event.Scope.WorkspacePath != `D:\repo` {
		t.Fatalf("workspace path = %q", event.Scope.WorkspacePath)
	}
	if event.Scope.Provider != "codex" {
		t.Fatalf("provider = %q", event.Scope.Provider)
	}
	if event.Scope.SessionID != "runtime-2" {
		t.Fatalf("session id = %q", event.Scope.SessionID)
	}
}

func TestEmitAgentRunChangedBroadcastsSingleDomainEvent(t *testing.T) {
	hub := New(context.Background())
	broadcaster := &recordingBroadcaster{}
	hub.SetBroadcaster(broadcaster)
	sub := hub.SubscribeDomain()
	defer sub.Close()

	completedAt := time.Now().UTC()
	hub.EmitAgentRunChanged(AgentRunChangedEvent{
		RunID:       42,
		AgentID:     7,
		AgentName:   "reviewer",
		Task:        "check changes",
		Model:       "sonnet",
		ProjectPath: `D:\repo`,
		SessionID:   "runtime-3",
		Status:      "completed",
		PID:         8080,
		CompletedAt: &completedAt,
	})

	event := waitDomainEvent(t, sub)
	if event.Type != "agent.run.completed" {
		t.Fatalf("domain type = %q, want agent.run.completed", event.Type)
	}
	if event.Source != "agent.run" {
		t.Fatalf("source = %q", event.Source)
	}
	if event.Scope.AgentRunID != 42 || event.Scope.AgentID != 7 {
		t.Fatalf("unexpected agent scope: %#v", event.Scope)
	}
	if event.Scope.ProjectPath != `D:\repo` || event.Scope.SessionID != "runtime-3" || event.Scope.PID != 8080 {
		t.Fatalf("unexpected scope: %#v", event.Scope)
	}
	if got := event.Payload["status"]; got != "completed" {
		t.Fatalf("payload status = %#v", got)
	}
	assertNoDomainEvent(t, sub)

	domainBroadcasts := 0
	runChangedBroadcasts := 0
	for _, broadcast := range broadcaster.events {
		switch broadcast.eventType {
		case "domain:event":
			domainBroadcasts++
		case "agent:run_changed":
			runChangedBroadcasts++
		}
	}
	if domainBroadcasts != 1 {
		t.Fatalf("domain broadcasts = %d, want 1; events=%#v", domainBroadcasts, broadcaster.events)
	}
	if runChangedBroadcasts != 1 {
		t.Fatalf("agent run broadcasts = %d, want 1; events=%#v", runChangedBroadcasts, broadcaster.events)
	}
}

func waitDomainEvent(t *testing.T, sub *DomainSubscription) DomainEvent {
	t.Helper()
	select {
	case event := <-sub.C:
		return event
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for domain event")
		return DomainEvent{}
	}
}

func assertNoDomainEvent(t *testing.T, sub *DomainSubscription) {
	t.Helper()
	select {
	case event := <-sub.C:
		t.Fatalf("unexpected domain event: %#v", event)
	case <-time.After(25 * time.Millisecond):
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
