// internal/session/history_test.go
package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewHistoryManager(t *testing.T) {
	claudeDir := "/tmp/test-claude"
	manager := NewHistoryManager(claudeDir)

	if manager == nil {
		t.Fatal("NewHistoryManager returned nil")
	}

	if manager.claudeDir != claudeDir {
		t.Errorf("Expected claudeDir %s, got %s", claudeDir, manager.claudeDir)
	}
}

func TestGetSessionFilePath(t *testing.T) {
	// Create a temporary test directory
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")

	// Create necessary directories
	projectID := "test-project"
	sessionID := "test-session"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatalf("Failed to create project directory: %v", err)
	}

	// Create a test session file
	sessionFile := filepath.Join(projectDir, sessionID+".jsonl")
	content := `{"type":"user","message":{"role":"user","content":"test"},"uuid":"123","timestamp":"2024-01-01T00:00:00Z","sessionId":"test-session"}
{"type":"assistant","message":{"model":"claude-3-5-sonnet-20241022","content":[{"type":"text","text":"response"}],"usage":{"input_tokens":10,"output_tokens":5}},"uuid":"456","timestamp":"2024-01-01T00:00:01Z"}
`
	if err := os.WriteFile(sessionFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create session file: %v", err)
	}

	manager := NewHistoryManager(claudeDir)

	// Test GetSessionFilePath
	filePath, err := manager.GetSessionFilePath(projectID, sessionID)
	if err != nil {
		t.Fatalf("GetSessionFilePath failed: %v", err)
	}

	if filePath != sessionFile {
		t.Errorf("Expected file path %s, got %s", sessionFile, filePath)
	}
}

func TestGetMessageIndex(t *testing.T) {
	// Create a temporary test directory
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")

	// Create necessary directories
	projectID := "test-project"
	sessionID := "test-session"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatalf("Failed to create project directory: %v", err)
	}

	// Create a test session file with 3 messages
	sessionFile := filepath.Join(projectDir, sessionID+".jsonl")
	content := `{"type":"user","message":{"role":"user","content":"test1"},"uuid":"123","timestamp":"2024-01-01T00:00:00Z"}
{"type":"assistant","message":{"model":"claude-3-5-sonnet-20241022","content":[{"type":"text","text":"response1"}],"usage":{"input_tokens":10,"output_tokens":5}},"uuid":"456","timestamp":"2024-01-01T00:00:01Z"}
{"type":"user","message":{"role":"user","content":"test2"},"uuid":"789","timestamp":"2024-01-01T00:00:02Z"}
`
	if err := os.WriteFile(sessionFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create session file: %v", err)
	}

	manager := NewHistoryManager(claudeDir)

	// Test GetMessageIndex
	index, err := manager.GetMessageIndex(projectID, sessionID)
	if err != nil {
		t.Fatalf("GetMessageIndex failed: %v", err)
	}

	expectedLength := 3
	if len(index) != expectedLength {
		t.Errorf("Expected %d messages, got %d", expectedLength, len(index))
	}

	// Check that line numbers are correct (1-based)
	for i, lineNum := range index {
		expectedLineNum := i + 1
		if lineNum != expectedLineNum {
			t.Errorf("Expected line number %d at index %d, got %d", expectedLineNum, i, lineNum)
		}
	}
}

func TestLoadSessionHistory(t *testing.T) {
	// Create a temporary test directory
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")

	// Create necessary directories
	projectID := "test-project"
	sessionID := "test-session"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatalf("Failed to create project directory: %v", err)
	}

	// Create a test session file
	sessionFile := filepath.Join(projectDir, sessionID+".jsonl")
	content := `{"type":"user","message":{"role":"user","content":"test message"},"uuid":"123","timestamp":"2024-01-01T00:00:00Z","sessionId":"test-session"}
{"type":"assistant","message":{"model":"claude-3-5-sonnet-20241022","content":[{"type":"text","text":"assistant response"}],"usage":{"input_tokens":10,"output_tokens":5}},"uuid":"456","timestamp":"2024-01-01T00:00:01Z"}
`
	if err := os.WriteFile(sessionFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create session file: %v", err)
	}

	manager := NewHistoryManager(claudeDir)

	// Test LoadSessionHistory
	messages, err := manager.LoadSessionHistory(projectID, sessionID)
	if err != nil {
		t.Fatalf("LoadSessionHistory failed: %v", err)
	}

	expectedCount := 2
	if len(messages) != expectedCount {
		t.Errorf("Expected %d messages, got %d", expectedCount, len(messages))
	}

	// Verify first message
	if messages[0].Type != "user" {
		t.Errorf("Expected first message type 'user', got '%s'", messages[0].Type)
	}

	if messages[0].UUID != "123" {
		t.Errorf("Expected first message UUID '123', got '%s'", messages[0].UUID)
	}

	// Verify second message
	if messages[1].Type != "assistant" {
		t.Errorf("Expected second message type 'assistant', got '%s'", messages[1].Type)
	}

	if messages[1].UUID != "456" {
		t.Errorf("Expected second message UUID '456', got '%s'", messages[1].UUID)
	}
}

func TestGetMessagesRange(t *testing.T) {
	// Create a temporary test directory
	tmpDir := t.TempDir()
	claudeDir := filepath.Join(tmpDir, ".claude")

	// Create necessary directories
	projectID := "test-project"
	sessionID := "test-session"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatalf("Failed to create project directory: %v", err)
	}

	// Create a test session file with 5 messages
	sessionFile := filepath.Join(projectDir, sessionID+".jsonl")
	content := `{"type":"user","message":{"role":"user","content":"msg1"},"uuid":"1","timestamp":"2024-01-01T00:00:00Z"}
{"type":"assistant","message":{"model":"claude-3-5-sonnet-20241022","content":[{"type":"text","text":"msg2"}],"usage":{}},"uuid":"2","timestamp":"2024-01-01T00:00:01Z"}
{"type":"user","message":{"role":"user","content":"msg3"},"uuid":"3","timestamp":"2024-01-01T00:00:02Z"}
{"type":"assistant","message":{"model":"claude-3-5-sonnet-20241022","content":[{"type":"text","text":"msg4"}],"usage":{}},"uuid":"4","timestamp":"2024-01-01T00:00:03Z"}
{"type":"user","message":{"role":"user","content":"msg5"},"uuid":"5","timestamp":"2024-01-01T00:00:04Z"}
`
	if err := os.WriteFile(sessionFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to create session file: %v", err)
	}

	manager := NewHistoryManager(claudeDir)

	// Test GetMessagesRange - get messages 2 to 4
	messages, err := manager.GetMessagesRange(projectID, sessionID, 2, 4)
	if err != nil {
		t.Fatalf("GetMessagesRange failed: %v", err)
	}

	expectedCount := 3
	if len(messages) != expectedCount {
		t.Errorf("Expected %d messages, got %d", expectedCount, len(messages))
	}

	// Verify we got the correct messages (UUIDs 2, 3, 4)
	expectedUUIDs := []string{"2", "3", "4"}
	for i, msg := range messages {
		if msg.UUID != expectedUUIDs[i] {
			t.Errorf("Expected message %d to have UUID '%s', got '%s'", i, expectedUUIDs[i], msg.UUID)
		}
	}
}
