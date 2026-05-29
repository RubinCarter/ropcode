package rpc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"ropcode/internal/database"
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

	handlers := AgentHandlers(&Deps{
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
}
