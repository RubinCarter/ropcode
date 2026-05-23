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
