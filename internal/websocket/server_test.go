package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"ropcode/internal/database"
	"ropcode/internal/stream"
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

type blockingRegistry struct {
	heartbeatStarted chan struct{}
	heartbeatDone    chan struct{}
	releaseHeartbeat chan struct{}
	staleWritten     chan struct{}

	startOnce sync.Once
	doneOnce  sync.Once
	staleOnce sync.Once
	mu        sync.Mutex
	record    *database.InstanceRecord
}

func newBlockingRegistry() *blockingRegistry {
	return &blockingRegistry{
		heartbeatStarted: make(chan struct{}),
		heartbeatDone:    make(chan struct{}),
		releaseHeartbeat: make(chan struct{}),
		staleWritten:     make(chan struct{}),
		record: &database.InstanceRecord{
			ID:          "inst-test",
			HeartbeatAt: 100,
			Status:      "alive",
		},
	}
}

func (r *blockingRegistry) RegisterInstance(record *database.InstanceRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	copyRecord := *record
	r.record = &copyRecord
	return nil
}

func (r *blockingRegistry) Heartbeat(id string, heartbeatAt int64) error {
	r.startOnce.Do(func() { close(r.heartbeatStarted) })
	<-r.releaseHeartbeat

	r.mu.Lock()
	defer r.mu.Unlock()
	r.record.HeartbeatAt = heartbeatAt
	r.record.Status = "alive"
	r.doneOnce.Do(func() { close(r.heartbeatDone) })
	return nil
}

func (r *blockingRegistry) MarkStaleInstances(cutoff int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.HeartbeatAt < cutoff {
		r.record.Status = "stale"
	}
	r.staleOnce.Do(func() { close(r.staleWritten) })
	return 1, nil
}

func (r *blockingRegistry) snapshot() database.InstanceRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	return *r.record
}

type registryTestApp struct {
	db *database.Database
}

func (a *registryTestApp) Database() *database.Database {
	return a.db
}

type splitStreamTestApp struct {
	sessionHub *stream.Hub
	syncHub    *stream.SyncHub
	bulkHub    *stream.BulkHub
}

func newSplitStreamTestApp() *splitStreamTestApp {
	return &splitStreamTestApp{
		sessionHub: stream.NewHub(),
		syncHub:    stream.NewSyncHub(),
		bulkHub:    stream.NewBulkHub(),
	}
}

func (a *splitStreamTestApp) Echo(value string) string {
	return value
}

func (a *splitStreamTestApp) SessionStreamHub() *stream.Hub {
	return a.sessionHub
}

func (a *splitStreamTestApp) SyncHub() *stream.SyncHub {
	return a.syncHub
}

func (a *splitStreamTestApp) BulkHub() *stream.BulkHub {
	return a.bulkHub
}

func openRegistryTestDB(t *testing.T) *database.Database {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "agents.db")
	db, err := database.Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	return db
}

func waitForCondition(t *testing.T, timeout time.Duration, check func() (bool, error)) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ok, err := check()
		if err != nil {
			t.Fatalf("condition check failed: %v", err)
		}
		if ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("condition was not met before timeout")
}

func TestServerStart_RegistersInstance(t *testing.T) {
	t.Setenv("ROPCODE_AUTH_KEY", "test-auth-key")

	originalInterval := heartbeatInterval
	heartbeatInterval = 20 * time.Millisecond
	defer func() {
		heartbeatInterval = originalInterval
	}()

	db := openRegistryTestDB(t)
	server := NewServer(&registryTestApp{db: db})

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	records, err := db.ListInstanceRecords()
	if err != nil {
		t.Fatalf("ListInstanceRecords failed: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 instance record, got %d", len(records))
	}

	record := records[0]
	if record.ID != server.GetInstanceID() {
		t.Fatalf("expected instance ID %q, got %q", server.GetInstanceID(), record.ID)
	}
	if record.Port != port {
		t.Fatalf("expected port %d, got %d", port, record.Port)
	}
	if record.AuthKey != server.GetAuthKey() {
		t.Fatalf("expected auth key %q, got %q", server.GetAuthKey(), record.AuthKey)
	}
	if record.PID != os.Getpid() {
		t.Fatalf("expected pid %d, got %d", os.Getpid(), record.PID)
	}
	if record.Status != "alive" {
		t.Fatalf("expected status alive, got %q", record.Status)
	}
	if record.Host != "127.0.0.1" {
		t.Fatalf("expected host 127.0.0.1, got %q", record.Host)
	}
	if record.StartedAt <= 0 || record.HeartbeatAt <= 0 {
		t.Fatalf("expected timestamps to be set, got started_at=%d heartbeat_at=%d", record.StartedAt, record.HeartbeatAt)
	}
	if !reflect.DeepEqual(record.Capabilities, []string{"rpc", "events"}) {
		t.Fatalf("unexpected capabilities: %#v", record.Capabilities)
	}

	initialHeartbeat := record.HeartbeatAt
	waitForCondition(t, 500*time.Millisecond, func() (bool, error) {
		updated, err := db.GetInstanceRecord(server.GetInstanceID())
		if err != nil {
			return false, err
		}
		return updated.HeartbeatAt > initialHeartbeat, nil
	})
}

func TestServerStop_MarksInstanceStale(t *testing.T) {
	db := openRegistryTestDB(t)
	server := NewServer(&registryTestApp{db: db})

	_, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	if err := server.Stop(context.Background()); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	record, err := db.GetInstanceRecord(server.GetInstanceID())
	if err != nil {
		t.Fatalf("GetInstanceRecord failed: %v", err)
	}
	if record.Status != "stale" {
		t.Fatalf("expected status stale after stop, got %q", record.Status)
	}
}

func TestServerStop_DoesNotAllowHeartbeatAfterStop(t *testing.T) {
	registry := newBlockingRegistry()
	server := &Server{
		instanceID: "inst-test",
		registry:   registry,
		stopCh:     make(chan struct{}),
	}

	originalInterval := heartbeatInterval
	heartbeatInterval = 10 * time.Millisecond
	defer func() {
		heartbeatInterval = originalInterval
	}()

	go server.heartbeatLoop()

	select {
	case <-registry.heartbeatStarted:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("heartbeat did not start")
	}

	stopDone := make(chan error, 1)
	go func() {
		stopDone <- server.Stop(context.Background())
	}()

	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatalf("Stop failed: %v", err)
		}
		t.Fatal("Stop returned before in-flight heartbeat was released")
	case <-time.After(50 * time.Millisecond):
	}

	close(registry.releaseHeartbeat)

	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatalf("Stop failed: %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Stop did not return")
	}

	select {
	case <-registry.staleWritten:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("stop did not mark instance stale")
	}

	record := registry.snapshot()
	if record.Status != "stale" {
		t.Fatalf("expected stale record after stop, got %q", record.Status)
	}
}

func TestHandleMessage_ReturnsPromptlyForSlowRPC(t *testing.T) {
	app := &rpcBlockingApp{
		startedSlow: make(chan struct{}),
		releaseSlow: make(chan struct{}),
	}
	server := NewServer(app)
	client := NewClient("test-client", nil)
	// NewClient now provisions Responses + Events channels with their own
	// capacities; tests no longer override the legacy single Send channel.

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

func TestSplitWebSocketPathsRequireAuth(t *testing.T) {
	t.Setenv("ROPCODE_AUTH_KEY", "secret")
	app := newSplitStreamTestApp()
	server := NewServer(app)

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	for _, path := range []string{
		"/ws/rpc",
		"/ws/sync",
		"/ws/stream/session/claude:runtime-1",
		"/ws/stream/bulk/pty/terminal-1",
	} {
		t.Run(path, func(t *testing.T) {
			conn, resp, err := websocket.DefaultDialer.Dial(wsURL(port, path, ""), nil)
			if err == nil {
				conn.Close()
				t.Fatal("dial without auth succeeded")
			}
			if resp == nil || resp.StatusCode != 401 {
				status := 0
				if resp != nil {
					status = resp.StatusCode
				}
				t.Fatalf("status = %d, want 401, err=%v", status, err)
			}
		})
	}
}

func TestRPCPathRespondsWhileSessionStreamSubscribed(t *testing.T) {
	app := newSplitStreamTestApp()
	server := NewServer(app)

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	streamConn, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/stream/session/claude:runtime-1", ""), nil)
	if err != nil {
		t.Fatalf("session stream dial failed: %v", err)
	}
	defer streamConn.Close()

	rpcConn, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/rpc", ""), nil)
	if err != nil {
		t.Fatalf("rpc dial failed: %v", err)
	}
	defer rpcConn.Close()

	request := WSMessage{
		Kind: "rpc_request",
		Request: &RPCRequest{
			ID:     "req-1",
			Method: "Echo",
			Params: []interface{}{"ok"},
		},
	}
	if err := rpcConn.WriteJSON(request); err != nil {
		t.Fatalf("write rpc request failed: %v", err)
	}

	_ = app.sessionHub.Append(stream.SessionFrame{
		StreamID:         "claude:runtime-1",
		FrameID:          "frame-1",
		Provider:         "claude",
		RuntimeSessionID: "runtime-1",
		Seq:              1,
		Kind:             stream.FrameKindMessage,
		Role:             stream.RoleAssistant,
		Content:          []stream.ContentBlock{{Type: stream.ContentText, Text: "hello"}},
	})

	if err := rpcConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	_, data, err := rpcConn.ReadMessage()
	if err != nil {
		t.Fatalf("rpc response was blocked: %v", err)
	}
	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("invalid rpc response: %v", err)
	}
	if msg.Response == nil || msg.Response.ID != "req-1" || msg.Response.Result != "ok" {
		t.Fatalf("unexpected rpc response: %#v", msg)
	}
}

func TestSessionStreamPathsAreIndependent(t *testing.T) {
	app := newSplitStreamTestApp()
	server := NewServer(app)

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	streamA, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/stream/session/claude:runtime-a", ""), nil)
	if err != nil {
		t.Fatalf("stream A dial failed: %v", err)
	}
	defer streamA.Close()
	streamB, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/stream/session/claude:runtime-b", ""), nil)
	if err != nil {
		t.Fatalf("stream B dial failed: %v", err)
	}
	defer streamB.Close()
	waitForCondition(t, 500*time.Millisecond, func() (bool, error) {
		return app.sessionHub.Diagnostics("claude:runtime-a").Subscribers == 1 &&
			app.sessionHub.Diagnostics("claude:runtime-b").Subscribers == 1, nil
	})

	if err := app.sessionHub.Append(stream.SessionFrame{
		StreamID:         "claude:runtime-b",
		FrameID:          "frame-b",
		Provider:         "claude",
		RuntimeSessionID: "runtime-b",
		Seq:              1,
		Kind:             stream.FrameKindMessage,
		Content:          []stream.ContentBlock{{Type: stream.ContentText, Text: "b"}},
	}); err != nil {
		t.Fatal(err)
	}

	if err := streamB.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	_, data, err := streamB.ReadMessage()
	if err != nil {
		t.Fatalf("stream B did not receive its frame: %v", err)
	}
	var frame stream.SessionFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("invalid stream frame: %v", err)
	}
	if frame.StreamID != "claude:runtime-b" || frame.Content[0].Text != "b" {
		t.Fatalf("unexpected stream B frame: %#v", frame)
	}

	if err := streamA.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := streamA.ReadMessage(); err == nil {
		t.Fatal("stream A unexpectedly received stream B frame")
	}
}

func TestSyncAndBulkPathsDeliverFrames(t *testing.T) {
	app := newSplitStreamTestApp()
	server := NewServer(app)

	port, err := server.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer func() {
		_ = server.Stop(context.Background())
	}()

	syncConn, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/sync", ""), nil)
	if err != nil {
		t.Fatalf("sync dial failed: %v", err)
	}
	defer syncConn.Close()
	bulkConn, _, err := websocket.DefaultDialer.Dial(wsURL(port, "/ws/stream/bulk/pty/terminal-1", ""), nil)
	if err != nil {
		t.Fatalf("bulk dial failed: %v", err)
	}
	defer bulkConn.Close()
	waitForCondition(t, 500*time.Millisecond, func() (bool, error) {
		return app.syncHub.Diagnostics().Subscribers == 1 &&
			app.bulkHub.Diagnostics("pty", "terminal-1").Subscribers == 1, nil
	})

	app.syncHub.Broadcast(stream.SyncEvent{Type: "project:changed", ProjectID: "project-1"})
	if err := app.bulkHub.Append(stream.BulkFrame{Source: "pty", ID: "terminal-1", Seq: 1, Data: "output"}); err != nil {
		t.Fatal(err)
	}

	if err := syncConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	_, syncData, err := syncConn.ReadMessage()
	if err != nil {
		t.Fatalf("sync frame not received: %v", err)
	}
	var syncEvent stream.SyncEvent
	if err := json.Unmarshal(syncData, &syncEvent); err != nil {
		t.Fatalf("invalid sync frame: %v", err)
	}
	if syncEvent.Type != "project:changed" || syncEvent.ProjectID != "project-1" {
		t.Fatalf("unexpected sync event: %#v", syncEvent)
	}

	if err := bulkConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	_, bulkData, err := bulkConn.ReadMessage()
	if err != nil {
		t.Fatalf("bulk frame not received: %v", err)
	}
	var bulkFrame stream.BulkFrame
	if err := json.Unmarshal(bulkData, &bulkFrame); err != nil {
		t.Fatalf("invalid bulk frame: %v", err)
	}
	if bulkFrame.Source != "pty" || bulkFrame.ID != "terminal-1" || bulkFrame.Data != "output" {
		t.Fatalf("unexpected bulk frame: %#v", bulkFrame)
	}
}

func wsURL(port int, path string, authKey string) string {
	u := url.URL{Scheme: "ws", Host: fmt.Sprintf("127.0.0.1:%d", port), Path: path}
	if authKey != "" {
		q := u.Query()
		q.Set("authKey", authKey)
		u.RawQuery = q.Encode()
	}
	return u.String()
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
