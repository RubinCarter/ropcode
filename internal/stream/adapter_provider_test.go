package stream

import (
	"testing"

	"ropcode/internal/provider"
)

func TestProviderBridgeRoutesOutputEventToDeterministicStream(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	err := bridge.EmitProviderOutput(ProviderOutputContext{
		RuntimeSessionID:  "runtime-1",
		ProviderSessionID: "provider-1",
		Cwd:               "E:/repo",
		ProjectPath:       "E:/repo",
	}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type":       "assistant",
			"unexpected": "kept",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	frame := receiveFrame(t, sub)
	if frame.StreamID != "claude:runtime-1" {
		t.Fatalf("expected deterministic stream id, got %q", frame.StreamID)
	}
	if frame.RuntimeSessionID != "runtime-1" || frame.ProviderSessionID != "provider-1" {
		t.Fatalf("unexpected ids: %#v", frame)
	}
	if frame.Provider != "claude" || frame.Cwd != "E:/repo" || frame.ProjectPath != "E:/repo" {
		t.Fatalf("unexpected route metadata: %#v", frame)
	}
	if frame.Meta.Raw["unexpected"] != "kept" {
		t.Fatalf("expected unknown provider field in meta.raw, got %#v", frame.Meta.Raw)
	}
}

func TestProviderBridgeUsesEventProviderAndRuntimeSessionFallbacks(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "event-runtime"))
	defer sub.Close()

	err := bridge.EmitProviderOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "event-runtime",
		Provider:  "codex",
		Message:   map[string]any{"type": "message", "text": "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}

	frame := receiveFrame(t, sub)
	if frame.RuntimeSessionID != "event-runtime" {
		t.Fatalf("expected event session fallback, got %q", frame.RuntimeSessionID)
	}
	if frame.Provider != "codex" {
		t.Fatalf("expected event provider fallback, got %q", frame.Provider)
	}
}

func TestProviderBridgeAssignsMonotonicSeqPerStream(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	subA := hub.Subscribe(StreamIDForSession("claude", "runtime-a"))
	defer subA.Close()
	subB := hub.Subscribe(StreamIDForSession("claude", "runtime-b"))
	defer subB.Close()

	events := []provider.OutputEvent{
		{Type: "assistant", SessionID: "runtime-a", Provider: "claude"},
		{Type: "assistant", SessionID: "runtime-a", Provider: "claude"},
		{Type: "assistant", SessionID: "runtime-b", Provider: "claude"},
	}
	for _, event := range events {
		if err := bridge.EmitProviderOutput(ProviderOutputContext{}, event); err != nil {
			t.Fatal(err)
		}
	}

	if got := receiveFrame(t, subA).Seq; got != 1 {
		t.Fatalf("expected stream A seq 1, got %d", got)
	}
	if got := receiveFrame(t, subA).Seq; got != 2 {
		t.Fatalf("expected stream A seq 2, got %d", got)
	}
	if got := receiveFrame(t, subB).Seq; got != 1 {
		t.Fatalf("expected stream B seq 1, got %d", got)
	}
}

func TestProviderBridgeEmitsTerminalRuntimeForClaudeEndTurn(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	err := bridge.EmitProviderOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role":        "assistant",
				"stop_reason": "end_turn",
				"content": []any{
					map[string]any{"type": "text", "text": "done"},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	frame := receiveFrame(t, sub)
	if frame.Kind != FrameKindResult {
		t.Fatalf("expected end_turn to be result frame, got %q", frame.Kind)
	}
	if frame.Runtime == nil || frame.Runtime.Phase != "completed" {
		t.Fatalf("expected completed runtime, got %#v", frame.Runtime)
	}
}

func TestProviderBridgeScopesTaskNotificationReplyToSidechain(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	events := []provider.OutputEvent{
		{
			Type:      "user",
			SessionID: "runtime-1",
			Provider:  "claude",
			Message: map[string]any{
				"type": "user",
				"message": map[string]any{
					"role":    "user",
					"content": "<task-notification><task-id>agent-1</task-id><status>completed</status></task-notification>",
				},
			},
		},
		{
			Type:      "assistant",
			SessionID: "runtime-1",
			Provider:  "claude",
			Message: map[string]any{
				"type": "assistant",
				"message": map[string]any{
					"role": "assistant",
					"content": []any{
						map[string]any{"type": "text", "text": "task summary"},
					},
				},
			},
		},
		{
			Type:      "assistant",
			SessionID: "runtime-1",
			Provider:  "claude",
			Message: map[string]any{
				"type": "assistant",
				"message": map[string]any{
					"role":        "assistant",
					"stop_reason": "end_turn",
					"content": []any{
						map[string]any{"type": "text", "text": "done"},
					},
				},
			},
		},
		{
			Type:      "assistant",
			SessionID: "runtime-1",
			Provider:  "claude",
			Message: map[string]any{
				"type": "assistant",
				"message": map[string]any{
					"role": "assistant",
					"content": []any{
						map[string]any{"type": "text", "text": "next root turn"},
					},
				},
			},
		},
	}

	for _, event := range events {
		if err := bridge.EmitProviderOutput(ProviderOutputContext{}, event); err != nil {
			t.Fatal(err)
		}
	}

	notification := receiveFrame(t, sub)
	reply := receiveFrame(t, sub)
	replyEnd := receiveFrame(t, sub)
	nextRoot := receiveFrame(t, sub)

	if !notification.Sidechain || notification.AgentID != "agent-1" {
		t.Fatalf("expected notification frame to be sidechain: %#v", notification)
	}
	if !reply.Sidechain || reply.AgentID != "agent-1" {
		t.Fatalf("expected task notification reply to be sidechain: %#v", reply)
	}
	if !replyEnd.Sidechain || replyEnd.AgentID != "agent-1" || replyEnd.Kind != FrameKindResult {
		t.Fatalf("expected task notification end_turn to be sidechain result: %#v", replyEnd)
	}
	if nextRoot.Sidechain {
		t.Fatalf("next root message must not inherit task sidechain scope: %#v", nextRoot)
	}
}
