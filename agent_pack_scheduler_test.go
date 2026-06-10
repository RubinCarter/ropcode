package main

import (
	"testing"
	"time"

	"ropcode/internal/agentpacks"
	"ropcode/internal/eventhub"
)

func TestAgentPackSchedulerCronMatches(t *testing.T) {
	mondayMorning := time.Date(2026, 6, 8, 9, 30, 0, 0, time.UTC)
	if !cronMatches("30 9 * * 1-5", mondayMorning) {
		t.Fatalf("expected weekday schedule to match Monday 09:30")
	}
	if cronMatches("30 8 * * 1-5", mondayMorning) {
		t.Fatalf("did not expect schedule to match the wrong hour")
	}
	sundayMorning := time.Date(2026, 6, 7, 9, 30, 0, 0, time.UTC)
	if cronMatches("30 9 * * 1-5", sundayMorning) {
		t.Fatalf("did not expect weekday schedule to match Sunday")
	}
	if !cronMatches("0 * * * *", time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("expected hourly top-of-hour schedule to match")
	}
}

func TestAgentPackSchedulerTargetsForSelectedScope(t *testing.T) {
	all := []agentPackTarget{
		{Kind: "project", Path: "/repo", Name: "repo"},
		{Kind: "workspace", Path: "/repo/worktree", Name: "feature", ProjectName: "repo"},
	}
	scope := map[string]any{
		"type": "selected",
		"targets": []any{
			map[string]any{
				"type":         "workspace",
				"path":         "/repo/worktree",
				"name":         "feature",
				"project_name": "repo",
			},
		},
	}
	targets := targetsForScope(scope, all)
	if len(targets) != 1 {
		t.Fatalf("selected targets len = %d, want 1", len(targets))
	}
	if targets[0].Path != "/repo/worktree" || targets[0].ProjectName != "repo" {
		t.Fatalf("selected target = %+v", targets[0])
	}
}

func TestAgentPackSchedulerTargetMatchesEvent(t *testing.T) {
	target := agentPackTarget{Kind: "workspace", Path: "/repo/worktree", Name: "feature"}
	event := eventhub.DomainEvent{
		Type: "git.dirty",
		Scope: eventhub.DomainEventScope{
			WorkspacePath: "/repo/worktree",
		},
	}
	if !targetMatchesEvent(target, event) {
		t.Fatalf("expected target to match workspace-scoped event")
	}
	if targetMatchesEvent(agentPackTarget{Kind: "workspace", Path: "/other", Name: "other"}, event) {
		t.Fatalf("did not expect unrelated target to match event")
	}
}

func TestAgentPackSchedulerTargetForEventPrefersWorkspace(t *testing.T) {
	scheduler := &agentPackScheduler{}
	target, ok := scheduler.targetForEvent(eventhub.DomainEvent{
		Scope: eventhub.DomainEventScope{
			ProjectPath:   "/repo",
			WorkspacePath: "/repo/worktree",
		},
	})
	if !ok {
		t.Fatalf("expected target from event")
	}
	if target.Kind != "workspace" || target.Path != "/repo/worktree" {
		t.Fatalf("target = %+v, want workspace /repo/worktree", target)
	}
}

func TestAgentPackSchedulerSessionTypeFiltersAgentEvents(t *testing.T) {
	scheduler := newAgentPackScheduler(nil)
	scheduler.markAutomationSession("runtime-1", agentSessionSource{PackID: "pack", AgentID: "memory-curator"})
	event := eventhub.DomainEvent{
		Type: "session.compacted",
		Scope: eventhub.DomainEventScope{
			SessionID:     "runtime-1",
			WorkspacePath: "/repo",
		},
	}

	selfTrigger := agentpacks.TriggerConfig{
		Mode:           "event",
		Enabled:        true,
		EventType:      "session.compacted",
		SessionType:    "agent",
		SessionAgentID: "memory-curator",
	}
	if scheduler.triggerMatchesEvent(selfTrigger, "pack", "memory-curator", event) {
		t.Fatalf("same agent must not trigger itself")
	}

	otherListener := agentpacks.TriggerConfig{
		Mode:           "event",
		Enabled:        true,
		EventType:      "session.compacted",
		SessionType:    "agent",
		SessionAgentID: "memory-curator",
	}
	if !scheduler.triggerMatchesEvent(otherListener, "pack", "reviewer", event) {
		t.Fatalf("different agent should be able to listen to memory-curator")
	}

	userOnly := agentpacks.TriggerConfig{
		Mode:        "event",
		Enabled:     true,
		EventType:   "session.compacted",
		SessionType: "user",
	}
	if scheduler.triggerMatchesEvent(userOnly, "pack", "reviewer", event) {
		t.Fatalf("user session trigger must not match agent session")
	}
}

func TestAgentPackSchedulerAgentRunFiltersByAgentID(t *testing.T) {
	scheduler := newAgentPackScheduler(nil)
	event := eventhub.DomainEvent{
		Type: "agent.run.completed",
		Payload: map[string]any{
			"agent_pack_id": "pack",
			"pack_agent_id": "memory-curator",
		},
	}

	selfTrigger := agentpacks.TriggerConfig{
		Mode:      "event",
		Enabled:   true,
		EventType: "agent.run.completed",
		AgentID:   "memory-curator",
	}
	if scheduler.triggerMatchesEvent(selfTrigger, "pack", "memory-curator", event) {
		t.Fatalf("same agent run must not trigger itself")
	}

	otherListener := agentpacks.TriggerConfig{
		Mode:      "event",
		Enabled:   true,
		EventType: "agent.run.completed",
		AgentID:   "memory-curator",
	}
	if !scheduler.triggerMatchesEvent(otherListener, "pack", "reviewer", event) {
		t.Fatalf("different agent should be able to listen to memory-curator run events")
	}

	wrongSource := agentpacks.TriggerConfig{
		Mode:      "event",
		Enabled:   true,
		EventType: "agent.run.completed",
		AgentID:   "commit-bot",
	}
	if scheduler.triggerMatchesEvent(wrongSource, "pack", "reviewer", event) {
		t.Fatalf("agent run trigger must respect agent_id")
	}
}
