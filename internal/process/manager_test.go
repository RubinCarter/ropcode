// internal/process/manager_test.go
package process

import (
	"context"
	"testing"
	"time"
)

func TestProcessManager_Spawn(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx)

	proc, err := manager.Spawn("test", "echo", []string{"hello"}, "/tmp", nil)
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}

	if proc.Key != "test" {
		t.Errorf("Expected key 'test', got '%s'", proc.Key)
	}

	// Wait for completion
	time.Sleep(100 * time.Millisecond)
}

func TestProcessManager_GracefulShutdown(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx)

	// Start a long-running process
	_, err := manager.Spawn("sleep", "sleep", []string{"10"}, "/tmp", nil)
	if err != nil {
		t.Fatalf("Spawn failed: %v", err)
	}

	if !manager.IsAlive("sleep") {
		t.Error("Process should be alive after spawn")
	}

	// Graceful shutdown
	err = manager.Kill("sleep")
	if err != nil {
		t.Errorf("Kill failed: %v", err)
	}

	// Wait a bit for cleanup
	time.Sleep(200 * time.Millisecond)

	// Verify process is gone
	if manager.IsAlive("sleep") {
		t.Error("Process should be dead after kill")
	}
}

func TestProcessManager_KillAll(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx)

	// Start multiple processes
	manager.Spawn("sleep1", "sleep", []string{"10"}, "/tmp", nil)
	manager.Spawn("sleep2", "sleep", []string{"10"}, "/tmp", nil)
	manager.Spawn("sleep3", "sleep", []string{"10"}, "/tmp", nil)

	if manager.Count() != 3 {
		t.Errorf("Expected 3 processes, got %d", manager.Count())
	}

	manager.KillAll()

	time.Sleep(200 * time.Millisecond)

	if manager.Count() != 0 {
		t.Errorf("Expected 0 processes after KillAll, got %d", manager.Count())
	}
}

func TestProcessManager_List(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx)

	manager.Spawn("proc1", "sleep", []string{"10"}, "/tmp", nil)
	manager.Spawn("proc2", "sleep", []string{"10"}, "/tmp", nil)

	keys := manager.List()
	if len(keys) != 2 {
		t.Errorf("Expected 2 keys, got %d", len(keys))
	}

	manager.KillAll()
}

func TestProcessManager_ReplaceProcess(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx)

	// Start first process
	proc1, err := manager.Spawn("myproc", "sleep", []string{"10"}, "/tmp", nil)
	if err != nil {
		t.Fatalf("First spawn failed: %v", err)
	}
	pid1 := proc1.PID

	// Replace with new process
	proc2, err := manager.Spawn("myproc", "sleep", []string{"10"}, "/tmp", nil)
	if err != nil {
		t.Fatalf("Second spawn failed: %v", err)
	}
	pid2 := proc2.PID

	if pid1 == pid2 {
		t.Error("Process should have been replaced with different PID")
	}

	// Only one process should exist
	if manager.Count() != 1 {
		t.Errorf("Expected 1 process after replacement, got %d", manager.Count())
	}

	manager.KillAll()
}
