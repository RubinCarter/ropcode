package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	ws "ropcode/internal/websocket"
)

type testApp struct{}

type wsTestServer struct {
	url  string
	done chan struct{}
}

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

func startWSTestServer(t *testing.T, handler func(*websocket.Conn)) *wsTestServer {
	t.Helper()

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("Upgrade failed: %v", err)
			return
		}
		go func() {
			defer conn.Close()
			handler(conn)
		}()
	}))

	parsed, err := url.Parse(server.URL)
	if err != nil {
		server.Close()
		t.Fatalf("Parse failed: %v", err)
	}
	parsed.Scheme = "ws"

	result := &wsTestServer{
		url:  parsed.String(),
		done: make(chan struct{}),
	}
	result.done = make(chan struct{})

	t.Cleanup(func() {
		server.Close()
	})

	return result
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

	// Wait for the server to register the client — there's a small window
	// between the WS handshake completing (Dial returns) and the server
	// adding the client to its map (handleWebSocket runs in a goroutine).
	deadline := time.Now().Add(2 * time.Second)
	for server.ClientCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for server to register client")
		}
		time.Sleep(5 * time.Millisecond)
	}

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

func TestRPCClient_BlockingEventHandlerDoesNotBlockResponse(t *testing.T) {
	server := startWSTestServer(t, func(conn *websocket.Conn) {
		var msg ws.WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		if err := conn.WriteJSON(&ws.WSMessage{
			Kind:  "event",
			Event: &ws.WSEvent{Type: "tick", Payload: map[string]any{"value": 1}},
		}); err != nil {
			return
		}
		_ = conn.WriteJSON(&ws.WSMessage{
			Kind:     "rpc_response",
			Response: &ws.RPCResponse{ID: msg.Request.ID, Result: "ok"},
		})
	})

	client, err := Dial(server.url, "")
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	handlerStarted := make(chan struct{})
	releaseHandler := make(chan struct{})
	client.OnEvent("tick", func(payload json.RawMessage) {
		close(handlerStarted)
		<-releaseHandler
	})

	callResult := make(chan error, 1)
	go func() {
		var out string
		err := client.Call("Greet", nil, &out)
		if err == nil && out != "ok" {
			err = fmt.Errorf("unexpected result: %q", out)
		}
		callResult <- err
	}()

	select {
	case <-handlerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for handler to start")
	}

	select {
	case err := <-callResult:
		if err != nil {
			t.Fatalf("Call failed: %v", err)
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("Call remained blocked behind event handler")
	}

	close(releaseHandler)
}

func TestRPCClient_HandleEventRecoversFromHandlerPanic(t *testing.T) {
	client := &Client{handlers: make(map[string][]EventHandler)}
	called := make(chan struct{}, 1)

	client.OnEvent("tick", func(payload json.RawMessage) {
		panic("boom")
	})
	client.OnEvent("tick", func(payload json.RawMessage) {
		called <- struct{}{}
	})

	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("handleEvent panicked: %v", r)
			}
		}()
		client.handleEvent(&ws.WSEvent{Type: "tick", Payload: map[string]any{"value": 1}})
	}()

	select {
	case <-called:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("non-panicking handler was not invoked")
	}
}

func TestRPCClient_CallTimesOut(t *testing.T) {
	originalTimeout := callTimeout
	callTimeout = 100 * time.Millisecond
	defer func() { callTimeout = originalTimeout }()

	server := startWSTestServer(t, func(conn *websocket.Conn) {
		var msg ws.WSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return
		}
		select {}
	})

	client, err := Dial(server.url, "")
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	start := time.Now()
	err = client.Call("Greet", nil, nil)
	if !errors.Is(err, ErrCallTimeout) {
		t.Fatalf("expected ErrCallTimeout, got %v", err)
	}
	if elapsed := time.Since(start); elapsed >= time.Second {
		t.Fatalf("Call timeout took too long: %v", elapsed)
	}
}

func TestRPCClient_CloseDoesNotHangOnBlockingEventHandler(t *testing.T) {
	sendEvent := make(chan struct{})
	server := startWSTestServer(t, func(conn *websocket.Conn) {
		<-sendEvent
		if err := conn.WriteJSON(&ws.WSMessage{
			Kind:  "event",
			Event: &ws.WSEvent{Type: "tick", Payload: map[string]any{"value": 1}},
		}); err != nil {
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	})

	client, err := Dial(server.url, "")
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}

	handlerStarted := make(chan struct{})
	releaseHandler := make(chan struct{})
	client.OnEvent("tick", func(payload json.RawMessage) {
		close(handlerStarted)
		<-releaseHandler
	})

	close(sendEvent)

	select {
	case <-handlerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for handler to start")
	}

	closeResult := make(chan error, 1)
	go func() {
		closeResult <- client.Close()
	}()

	select {
	case err := <-closeResult:
		if err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("Close remained blocked behind event handler")
	}

	close(releaseHandler)
}
