package runtime

import (
	"reflect"
	"testing"

	"ropcode/internal/database"
)

func TestRegistry(t *testing.T) {
	db := openTestDB(t)
	registry := NewRegistry(db)

	record := &database.InstanceRecord{
		ID:           "inst-a",
		Label:        "Primary",
		Host:         "127.0.0.1",
		Port:         9001,
		AuthKey:      "secret",
		PID:          111,
		StartedAt:    100,
		HeartbeatAt:  100,
		Status:       "alive",
		Capabilities: []string{"rpc", "events"},
	}

	if err := registry.RegisterInstance(record); err != nil {
		t.Fatalf("RegisterInstance failed: %v", err)
	}

	if err := registry.Heartbeat("inst-a", 250); err != nil {
		t.Fatalf("Heartbeat failed: %v", err)
	}

	alive, err := registry.ListAliveInstances()
	if err != nil {
		t.Fatalf("ListAliveInstances failed: %v", err)
	}
	if len(alive) != 1 {
		t.Fatalf("expected 1 alive instance, got %d", len(alive))
	}
	if alive[0].HeartbeatAt != 250 {
		t.Fatalf("expected updated heartbeat, got %d", alive[0].HeartbeatAt)
	}
	if !reflect.DeepEqual(alive[0].Capabilities, []string{"rpc", "events"}) {
		t.Fatalf("unexpected capabilities: %#v", alive[0].Capabilities)
	}

	staleCount, err := registry.MarkStaleInstances(251)
	if err != nil {
		t.Fatalf("MarkStaleInstances failed: %v", err)
	}
	if staleCount != 1 {
		t.Fatalf("expected 1 stale instance, got %d", staleCount)
	}

	alive, err = registry.ListAliveInstances()
	if err != nil {
		t.Fatalf("ListAliveInstances after stale failed: %v", err)
	}
	if len(alive) != 0 {
		t.Fatalf("expected 0 alive instances after stale mark, got %d", len(alive))
	}
}

func openTestDB(t *testing.T) *database.Database {
	t.Helper()

	db := databaseTestOpen(t)
	return db
}

func databaseTestOpen(t *testing.T) *database.Database {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath := tmpDir + "/test.db"

	db, err := database.Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}

	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	})

	return db
}
