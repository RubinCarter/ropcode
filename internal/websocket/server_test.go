package websocket

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"ropcode/internal/database"
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
