package websocket

import (
	"testing"
	"time"
)

type rpcBlockingApp struct {
	startedSlow chan struct{}
	releaseSlow chan struct{}
}

func (a *rpcBlockingApp) Slow() string {
	close(a.startedSlow)
	<-a.releaseSlow
	return "slow"
}

func TestHandleMessage_ReturnsPromptlyForSlowRPC(t *testing.T) {
	app := &rpcBlockingApp{
		startedSlow: make(chan struct{}),
		releaseSlow: make(chan struct{}),
	}
	server := NewServer(app)
	client := NewClient("test-client", nil)
	client.Send = make(chan []byte, 10)

	message := []byte(`{"kind":"rpc_request","request":{"id":"slow","method":"Slow","params":[]}}`)
	returned := make(chan struct{})

	go func() {
		server.handleMessage(client, message)
		close(returned)
	}()

	select {
	case <-app.startedSlow:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("slow RPC did not start")
	}

	select {
	case <-returned:
		// expected after async dispatch
	case <-time.After(200 * time.Millisecond):
		t.Fatal("handleMessage blocked on slow RPC")
	}

	close(app.releaseSlow)
}

func TestSendResponse_AfterClientClose_DoesNotPanic(t *testing.T) {
	client := NewClient("test-client", nil)
	client.Close()

	panicCh := make(chan interface{}, 1)
	done := make(chan struct{})

	go func() {
		defer close(done)
		defer func() {
			if r := recover(); r != nil {
				panicCh <- r
			}
		}()

		_ = client.SendResponse("req-1", map[string]string{"ok": "true"}, "")
	}()

	select {
	case p := <-panicCh:
		t.Fatalf("SendResponse panicked after client close: %v", p)
	case <-done:
		// expected
	case <-time.After(200 * time.Millisecond):
		t.Fatal("SendResponse did not return")
	}
}
