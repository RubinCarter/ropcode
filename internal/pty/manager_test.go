// internal/pty/manager_test.go
package pty

import (
	"context"
	"testing"
	"time"
)

func waitForSessionStart(t *testing.T, session *Session) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if session.IsStarted() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("session did not start within timeout")
}

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

	waitForSessionStart(t, session)

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

	session, err := manager.CreateSession("test-write", "/tmp", 24, 80, "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	waitForSessionStart(t, session)

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

	waitForSessionStart(t, session)

	if session.Rows != 48 || session.Cols != 120 {
		t.Errorf("Expected 48x120, got %dx%d", session.Rows, session.Cols)
	}

	manager.CloseSession("test-resize")
}

func TestPtyManager_ResizeMissingSessionIsNoop(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	if err := manager.Resize("missing-session", 48, 120); err != nil {
		t.Fatalf("expected missing session resize to be ignored, got %v", err)
	}
}

func TestPtyManager_WriteMissingSessionStillErrors(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	if err := manager.Write("missing-session", "hello"); err == nil {
		t.Fatal("expected missing session write to fail")
	}
}

func TestPtyManager_CloseAll(t *testing.T) {
	ctx := context.Background()
	manager := NewManager(ctx, nil)

	// Create multiple sessions
	session1, _ := manager.CreateSession("session1", "/tmp", 24, 80, "")
	session2, _ := manager.CreateSession("session2", "/tmp", 24, 80, "")
	session3, _ := manager.CreateSession("session3", "/tmp", 24, 80, "")

	waitForSessionStart(t, session1)
	waitForSessionStart(t, session2)
	waitForSessionStart(t, session3)

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

func TestPtyFlushDelayUsesInteractivePathForEchoAndControlBytes(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want time.Duration
	}{
		{name: "single key echo", data: []byte("s"), want: ptyInteractiveFlush},
		{name: "enter echo", data: []byte("\r\n"), want: ptyInteractiveFlush},
		{name: "escape sequence", data: []byte("\x1b[?25h"), want: ptyInteractiveFlush},
		{name: "osc terminator", data: []byte("\x07"), want: ptyInteractiveFlush},
		{name: "bulk output", data: []byte("this is a longer output chunk without control bytes"), want: ptyFlushInterval},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ptyFlushDelay(tt.data); got != tt.want {
				t.Fatalf("ptyFlushDelay(%q) = %s, want %s", string(tt.data), got, tt.want)
			}
		})
	}
}

func TestSessionNextSeqIsMonotonic(t *testing.T) {
	session, err := NewSession("test-seq", "/tmp", 24, 80, "/bin/sh")
	if err != nil {
		t.Fatalf("NewSession failed: %v", err)
	}

	if got := []int64{session.NextSeq(), session.NextSeq(), session.NextSeq()}; got[0] != 1 || got[1] != 2 || got[2] != 3 {
		t.Fatalf("unexpected seq values: %v", got)
	}
}
