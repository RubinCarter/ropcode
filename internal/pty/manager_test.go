// internal/pty/manager_test.go
package pty

import (
	"context"
	"testing"
	"time"
)

func TestPtyManager_CreateSession(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil) // nil emitter for testing

	session, err := manager.CreateSession("test-session", "/tmp", 24, 80, "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	if session.ID != "test-session" {
		t.Errorf("Expected session ID 'test-session', got '%s'", session.ID)
	}

	// Verify session is tracked
	sessions := manager.ListSessions()
	if len(sessions) != 1 {
		t.Errorf("Expected 1 session, got %d", len(sessions))
	}

	// Cleanup
	manager.CloseSession("test-session")
}

func TestPtyManager_WriteToSession(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	_, err := manager.CreateSession("test-write", "/tmp", 24, 80, "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	err = manager.Write("test-write", "echo hello\n")
	if err != nil {
		t.Errorf("Write failed: %v", err)
	}

	// Wait for command execution
	time.Sleep(100 * time.Millisecond)

	manager.CloseSession("test-write")
}

func TestPtyManager_ResizeSession(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	session, err := manager.CreateSession("test-resize", "/tmp", 24, 80, "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	err = manager.Resize("test-resize", 48, 120)
	if err != nil {
		t.Errorf("Resize failed: %v", err)
	}

	if session.Rows != 48 || session.Cols != 120 {
		t.Errorf("Expected 48x120, got %dx%d", session.Rows, session.Cols)
	}

	manager.CloseSession("test-resize")
}

func TestPtyManager_CloseAll(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	// Create multiple sessions
	manager.CreateSession("session1", "/tmp", 24, 80, "")
	manager.CreateSession("session2", "/tmp", 24, 80, "")
	manager.CreateSession("session3", "/tmp", 24, 80, "")

	sessions := manager.ListSessions()
	if len(sessions) != 3 {
		t.Errorf("Expected 3 sessions, got %d", len(sessions))
	}

	manager.CloseAll()

	sessions = manager.ListSessions()
	if len(sessions) != 0 {
		t.Errorf("Expected 0 sessions after CloseAll, got %d", len(sessions))
	}
}
