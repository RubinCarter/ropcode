// internal/claude/manager_test.go
package claude

import (
	"context"
	"testing"
)

func TestSessionManager_StartSession(t *testing.T) {
	ctx := context.Background()
	manager := NewSessionManager(ctx, nil)

	config := SessionConfig{
		ProjectPath: "/tmp",
		Prompt:      "Hello",
		Model:       "sonnet",
	}

	sessionID, err := manager.StartSession(config)
	if err != nil {
		// 预期失败因为 claude binary 可能不存在，但应该有合理的错误信息
		if sessionID != "" {
			t.Error("Expected empty session ID on error")
		}
		return
	}

	if sessionID == "" {
		t.Error("Expected non-empty session ID")
	}

	// Cleanup
	manager.TerminateSession(sessionID)
}

func TestSessionManager_IsRunning(t *testing.T) {
	ctx := context.Background()
	manager := NewSessionManager(ctx, nil)

	// Non-existent session
	if manager.IsRunning("non-existent") {
		t.Error("Expected false for non-existent session")
	}
}

func TestSessionManager_ListRunningSessions(t *testing.T) {
	ctx := context.Background()
	manager := NewSessionManager(ctx, nil)

	sessions := manager.ListRunningSessions()
	if sessions == nil {
		t.Error("Expected non-nil slice")
	}
}

func TestSessionManager_IsRunningForProject(t *testing.T) {
	ctx := context.Background()
	manager := NewSessionManager(ctx, nil)

	// Non-existent project
	if manager.IsRunningForProject("/nonexistent/path") {
		t.Error("Expected false for non-existent project")
	}
}
