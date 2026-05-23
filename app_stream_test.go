package main

import (
	"testing"

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
