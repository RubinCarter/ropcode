package rpc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/provider"
)

func TestListRunningAgentRunsMarksMissingProviderSessionFailed(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "ropcode-test.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()

	run := &database.AgentRun{
		AgentID:     1,
		AgentName:   "test",
		ProjectPath: t.TempDir(),
		SessionID:   "missing-session",
		Status:      "running",
	}
	runID, err := db.CreateAgentRun(run)
	if err != nil {
		t.Fatalf("create agent run: %v", err)
	}

	hub := eventhub.New(context.Background())
	sub := hub.SubscribeDomain()
	defer sub.Close()

	handlers := AgentHandlers(&Deps{
		EventHub: hub,
		DB:       db,
		Provider: provider.NewManager(context.Background(), nil, nil),
	})
	result, err := handlers["ListRunningAgentRuns"](json.RawMessage(`[]`))
	if err != nil {
		t.Fatalf("list running agent runs: %v", err)
	}
	if runs, ok := result.([]*database.AgentRun); !ok {
		t.Fatalf("unexpected result type %T", result)
	} else if len(runs) != 0 {
		t.Fatalf("expected no active running runs, got %d", len(runs))
	}

	updated, err := db.GetAgentRun(runID)
	if err != nil {
		t.Fatalf("get updated agent run: %v", err)
	}
	if updated.Status != "failed" {
		t.Fatalf("expected stale run status failed, got %q", updated.Status)
	}
	if updated.CompletedAt == nil {
		t.Fatal("expected stale run completed_at to be set")
	}

	event := waitAgentRunDomainEvent(t, sub)
	if event.Type != "agent.run.failed" {
		t.Fatalf("domain event type = %q, want agent.run.failed", event.Type)
	}
	if event.Scope.AgentRunID != runID || event.Scope.AgentID != 1 {
		t.Fatalf("unexpected event scope: %#v", event.Scope)
	}
	if event.Scope.ProjectPath != run.ProjectPath || event.Scope.SessionID != "missing-session" {
		t.Fatalf("unexpected project/session scope: %#v", event.Scope)
	}
	if got := event.Payload["status"]; got != "failed" {
		t.Fatalf("payload status = %#v, want failed", got)
	}
	if got := event.Payload["error"]; got != "provider session not found" {
		t.Fatalf("payload error = %#v", got)
	}
}

func waitAgentRunDomainEvent(t *testing.T, sub *eventhub.DomainSubscription) eventhub.DomainEvent {
	t.Helper()
	select {
	case event := <-sub.C:
		return event
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for agent run domain event")
		return eventhub.DomainEvent{}
	}
}
