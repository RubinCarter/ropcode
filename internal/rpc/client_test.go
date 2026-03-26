package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	ws "ropcode/internal/websocket"
)

type testApp struct{}

func (a *testApp) Greet(name string) string {
	return "Hello " + name + ", Welcome to ropcode!"
}

func startTestServer(t *testing.T, server *ws.Server) int {
	t.Helper()

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	t.Cleanup(func() {
		_ = server.Stop(context.Background())
	})

	return port
}

func TestRPCClient_Call(t *testing.T) {
	app := &testApp{}
	server := ws.NewServer(app)
	port := startTestServer(t, server)

	client, err := Dial(fmt.Sprintf("ws://127.0.0.1:%d/ws", port), server.GetAuthKey())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	var result string
	if err := client.Call("Greet", []any{"CLI"}, &result); err != nil {
		t.Fatalf("Call failed: %v", err)
	}
	if result != "Hello CLI, Welcome to ropcode!" {
		t.Fatalf("unexpected result: %s", result)
	}
}

func TestRPCClient_OnEvent(t *testing.T) {
	app := &testApp{}
	server := ws.NewServer(app)
	port := startTestServer(t, server)

	client, err := Dial(fmt.Sprintf("ws://127.0.0.1:%d/ws", port), server.GetAuthKey())
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	events := make(chan json.RawMessage, 1)
	client.OnEvent("tick", func(payload json.RawMessage) {
		copyPayload := append(json.RawMessage(nil), payload...)
		events <- copyPayload
	})

	server.BroadcastEvent("tick", map[string]any{"value": 7})

	select {
	case payload := <-events:
		var decoded map[string]int
		if err := json.Unmarshal(payload, &decoded); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}
		if decoded["value"] != 7 {
			t.Fatalf("unexpected payload: %#v", decoded)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event")
	}
}
