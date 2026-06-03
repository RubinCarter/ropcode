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

func TestProviderBridgeFrameIdentityIgnoresSeqForNativeMessageID(t *testing.T) {
	bridge := NewProviderBridge(NewHub())
	event := assistantMessageEvent("runtime-1", "msg-1", "same message")

	first, err := bridge.FrameFromProviderOutput(ProviderOutputContext{}, event)
	if err != nil {
		t.Fatal(err)
	}
	second, err := bridge.FrameFromProviderOutput(ProviderOutputContext{}, event)
	if err != nil {
		t.Fatal(err)
	}

	if first.Seq == second.Seq {
		t.Fatalf("expected monotonic seq to keep display ordering, got %d and %d", first.Seq, second.Seq)
	}
	if first.FrameID != second.FrameID {
		t.Fatalf("expected stable frame id to ignore seq, got %q and %q", first.FrameID, second.FrameID)
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

func TestProviderBridgeSuppressesPlainUserEchoFrames(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	err := bridge.EmitProviderOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "<previous_conversation>\n[Assistant]: prior\n</previous_conversation>\n\nhi"},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := hub.Diagnostics(StreamIDForSession("claude", "runtime-1")).QueueLength; got != 0 {
		t.Fatalf("expected user echo to be suppressed from queue, got %d frames", got)
	}

	select {
	case frame := <-sub.C:
		t.Fatalf("plain user echo should not be broadcast, got %#v", frame)
	default:
	}
}

func TestProviderBridgeAggregatesAssistantTextDeltasByMessageID(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "runtime-1"))
	defer sub.Close()

	events := []provider.OutputEvent{
		assistantDeltaEvent("runtime-1", "msg-1", "hel"),
		assistantDeltaEvent("runtime-1", "msg-1", "lo"),
	}
	for _, event := range events {
		if err := bridge.EmitProviderOutput(ProviderOutputContext{}, event); err != nil {
			t.Fatal(err)
		}
	}

	first := receiveFrame(t, sub)
	second := receiveFrame(t, sub)

	if first.Kind != FrameKindMessage || second.Kind != FrameKindMessage {
		t.Fatalf("expected deltas to be emitted as message upserts, got %q and %q", first.Kind, second.Kind)
	}
	if first.Operation != FrameOperationUpsert || second.Operation != FrameOperationUpsert {
		t.Fatalf("expected upsert operations, got %q and %q", first.Operation, second.Operation)
	}
	if first.MessageID != "msg-1" || second.MessageID != "msg-1" {
		t.Fatalf("expected stable message id, got %q and %q", first.MessageID, second.MessageID)
	}
	if got := frameContentText(first.Content); got != "hel" {
		t.Fatalf("expected first aggregate text, got %q", got)
	}
	if got := frameContentText(second.Content); got != "hello" {
		t.Fatalf("expected second aggregate text, got %q", got)
	}
	rawContent := sliceFromAny(mapFromAny(second.Meta.Raw["message"])["content"])
	if len(rawContent) != 1 || stringFromMap(mapFromAny(rawContent[0]), "text") != "hello" {
		t.Fatalf("expected raw payload to contain aggregate text, got %#v", second.Meta.Raw)
	}
}

func TestProviderBridgeSuppressesShortCompletedEchoAfterAggregatedDeltas(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "runtime-1"))
	defer sub.Close()

	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantDeltaEvent("runtime-1", "msg-1", "hello world")); err != nil {
		t.Fatal(err)
	}
	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantMessageEvent("runtime-1", "msg-1", "hello")); err != nil {
		t.Fatal(err)
	}

	aggregate := receiveFrame(t, sub)
	if got := frameContentText(aggregate.Content); got != "hello world" {
		t.Fatalf("expected aggregate text, got %q", got)
	}
	if got := hub.Diagnostics(StreamIDForSession("codex", "runtime-1")).QueueLength; got != 1 {
		t.Fatalf("expected completed echo to be suppressed from queue, got %d frames", got)
	}
	select {
	case frame := <-sub.C:
		t.Fatalf("completed echo should not be broadcast, got %#v", frame)
	default:
	}
}

func TestProviderBridgeUpsertsCompletedFullTextAfterAggregatedDeltas(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "runtime-1"))
	defer sub.Close()

	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantDeltaEvent("runtime-1", "msg-1", "The right fix is")); err != nil {
		t.Fatal(err)
	}
	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantMessageEvent("runtime-1", "msg-1", "The right fix is to reconcile provider differences in the backend")); err != nil {
		t.Fatal(err)
	}

	aggregate := receiveFrame(t, sub)
	completed := receiveFrame(t, sub)

	if got := frameContentText(aggregate.Content); got != "The right fix is" {
		t.Fatalf("expected aggregate text, got %q", got)
	}
	if completed.Operation != FrameOperationUpsert {
		t.Fatalf("expected completed full text to upsert streamed frame, got %q", completed.Operation)
	}
	if completed.MessageID != "msg-1" {
		t.Fatalf("expected stable message id, got %q", completed.MessageID)
	}
	if got := frameContentText(completed.Content); got != "The right fix is to reconcile provider differences in the backend" {
		t.Fatalf("expected completed full text, got %q", got)
	}
}

func TestProviderBridgeTreatsCompletedTextAsAuthoritativeAfterDeltas(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "runtime-1"))
	defer sub.Close()

	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantDeltaEvent("runtime-1", "msg-1", "The right implementation")); err != nil {
		t.Fatal(err)
	}
	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantMessageEvent("runtime-1", "msg-1", "A robust implementation uses backend stream upserts")); err != nil {
		t.Fatal(err)
	}

	_ = receiveFrame(t, sub)
	completed := receiveFrame(t, sub)

	if completed.Operation != FrameOperationUpsert {
		t.Fatalf("expected authoritative completed text to upsert streamed frame, got %q", completed.Operation)
	}
	if got := frameContentText(completed.Content); got != "A robust implementation uses backend stream upserts" {
		t.Fatalf("expected authoritative completed text, got %q", got)
	}
}

func TestProviderBridgeUpsertsCompletedTextAfterResultClearsDeltaState(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("codex", "runtime-1"))
	defer sub.Close()

	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantDeltaEvent("runtime-1", "msg-1", "partial")); err != nil {
		t.Fatal(err)
	}
	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		Subtype:   "result",
		SessionID: "runtime-1",
		Provider:  "codex",
		Message: map[string]any{
			"type":    "result",
			"subtype": "success",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := bridge.EmitProviderOutput(ProviderOutputContext{}, assistantMessageEvent("runtime-1", "msg-1", "complete final reply")); err != nil {
		t.Fatal(err)
	}

	streamed := receiveFrame(t, sub)
	_ = receiveFrame(t, sub)
	completed := receiveFrame(t, sub)

	if completed.Operation != FrameOperationUpsert {
		t.Fatalf("expected completed text to upsert streamed frame after result, got %q", completed.Operation)
	}
	if completed.FrameID != streamed.FrameID {
		t.Fatalf("expected completed text to reuse streamed frame identity, got %q and %q", streamed.FrameID, completed.FrameID)
	}
	if got := frameContentText(completed.Content); got != "complete final reply" {
		t.Fatalf("expected complete final reply, got %q", got)
	}
}

func TestProviderBridgeSuppressesUserEchoWithInjectedSystemPrompt(t *testing.T) {
	hub := NewHub()
	bridge := NewProviderBridge(hub)
	sub := hub.Subscribe(StreamIDForSession("claude", "runtime-1"))
	defer sub.Close()

	err := bridge.EmitProviderOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "text", "text": "<system_instruction>\nWork inside the worktree.\n</system_instruction>\n\nhi"},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := hub.Diagnostics(StreamIDForSession("claude", "runtime-1")).QueueLength; got != 0 {
		t.Fatalf("expected wrapped user echo to be suppressed from queue, got %d frames", got)
	}

	select {
	case frame := <-sub.C:
		t.Fatalf("wrapped user echo should not be broadcast, got %#v", frame)
	default:
	}
}

func assistantDeltaEvent(runtimeSessionID, messageID, text string) provider.OutputEvent {
	return provider.OutputEvent{
		Type:      "assistant",
		SessionID: runtimeSessionID,
		Provider:  "codex",
		IsDelta:   true,
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"id":   messageID,
				"role": "assistant",
				"content": []any{
					map[string]any{"type": "text", "text": text},
				},
			},
		},
	}
}

func assistantMessageEvent(runtimeSessionID, messageID, text string) provider.OutputEvent {
	return provider.OutputEvent{
		Type:      "assistant",
		SessionID: runtimeSessionID,
		Provider:  "codex",
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"id":   messageID,
				"role": "assistant",
				"content": []any{
					map[string]any{"type": "text", "text": text},
				},
			},
		},
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
