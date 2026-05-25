package main

import (
	"testing"

	"ropcode/internal/claudeactivity"
	"ropcode/internal/eventhub"
	"ropcode/internal/provider"
	"ropcode/internal/stream"
)

func TestProviderStreamEmitterAcceptsPointerOutputEvents(t *testing.T) {
	hub := stream.NewHub()
	emitter := &providerStreamEmitter{
		eventHub: eventhub.New(nil),
		bridge:   stream.NewProviderBridge(hub),
	}
	sub := hub.Subscribe(stream.StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	emitter.Emit("provider-output", &provider.OutputEvent{
		Type:              "assistant",
		SessionID:         "runtime-1",
		Provider:          "claude",
		ProviderSessionID: "provider-1",
		ProjectPath:       "E:/repo",
		Cwd:               "E:/repo",
		Message:           map[string]any{"type": "assistant"},
	})

	frame := receiveFrameFromAppTest(t, sub)
	if frame.RuntimeSessionID != "runtime-1" || frame.ProviderSessionID != "provider-1" {
		t.Fatalf("unexpected frame identity: %#v", frame)
	}
}

func TestProviderStreamEmitterFeedsClaudeActivityService(t *testing.T) {
	activity := claudeactivity.NewService()
	activity.EnsureSession("runtime-1", "E:/repo", true, nil)
	hub := stream.NewHub()
	emitter := &providerStreamEmitter{
		eventHub:       eventhub.New(nil),
		bridge:         stream.NewProviderBridge(hub),
		claudeActivity: activity,
	}

	emitter.Emit("provider-output", provider.OutputEvent{
		Type:              "user",
		SessionID:         "runtime-1",
		Provider:          "claude",
		ProviderSessionID: "provider-1",
		ProjectPath:       "E:/repo",
		Cwd:               "E:/repo",
		Message: map[string]any{
			"type": "user",
			"toolUseResult": map[string]any{
				"isAsync":     true,
				"status":      "async_launched",
				"agentId":     "agent-1",
				"description": "Investigate history",
			},
		},
	})

	snapshot, err := activity.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Subagents) != 1 {
		t.Fatalf("expected one subagent activity, got %d", len(snapshot.Subagents))
	}
	if snapshot.Subagents[0].ID != "agent-1" {
		t.Fatalf("unexpected subagent: %#v", snapshot.Subagents[0])
	}
}

func TestReplayClaudeActivityOutputHydratesMissedAsyncAgent(t *testing.T) {
	activity := claudeactivity.NewService()
	activity.EnsureSession("runtime-1", "E:/repo", true, nil)

	replayClaudeActivityOutput(activity, "runtime-1", `{"type":"user","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"agent-1","description":"Investigate history"}}`+"\n")

	snapshot, err := activity.GetSnapshot("runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Subagents) != 1 {
		t.Fatalf("expected one replayed subagent, got %d", len(snapshot.Subagents))
	}
	if snapshot.Subagents[0].ID != "agent-1" {
		t.Fatalf("unexpected subagent: %#v", snapshot.Subagents[0])
	}
}

func receiveFrameFromAppTest(t *testing.T, sub *stream.Subscription) stream.SessionFrame {
	t.Helper()
	select {
	case frame, ok := <-sub.C:
		if !ok {
			t.Fatal("subscription closed")
		}
		return frame
	default:
		t.Fatal("expected provider output frame")
		return stream.SessionFrame{}
	}
}
