// internal/checkpoint/storage_test.go
package checkpoint

import (
	"testing"
	"time"
)

func TestCheckpointStorage_Save(t *testing.T) {
	tmpDir := t.TempDir()
	storage := NewStorage(tmpDir, 3)

	checkpoint := &Checkpoint{
		ID:           "cp-001",
		SessionID:    "session-001",
		MessageIndex: 10,
		Description:  "Test checkpoint",
		Timestamp:    time.Now(),
	}

	files := []FileSnapshot{
		{
			CheckpointID: "cp-001",
			FilePath:     "/tmp/test.txt",
			Content:      "Hello, World!",
			Hash:         CalculateHash("Hello, World!"),
			Size:         13,
		},
	}

	result, err := storage.Save("project-001", "session-001", checkpoint, files, "messages content")
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	if result.FilesProcessed != 1 {
		t.Errorf("Expected 1 file processed, got %d", result.FilesProcessed)
	}
}

func TestCheckpointStorage_Load(t *testing.T) {
	tmpDir := t.TempDir()
	storage := NewStorage(tmpDir, 3)

	checkpoint := &Checkpoint{
		ID:           "cp-002",
		SessionID:    "session-002",
		MessageIndex: 5,
		Timestamp:    time.Now(),
	}

	_, err := storage.Save("project-002", "session-002", checkpoint, nil, "test messages")
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	loaded, _, messages, err := storage.Load("project-002", "session-002", "cp-002")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if loaded.ID != "cp-002" {
		t.Errorf("Expected ID 'cp-002', got '%s'", loaded.ID)
	}

	if messages != "test messages" {
		t.Errorf("Expected 'test messages', got '%s'", messages)
	}
}

func TestCheckpointStorage_List(t *testing.T) {
	tmpDir := t.TempDir()
	storage := NewStorage(tmpDir, 3)

	// Save multiple checkpoints
	for i := 1; i <= 3; i++ {
		cp := &Checkpoint{
			ID:           GenerateID(),
			SessionID:    "session-list",
			MessageIndex: i * 10,
			Timestamp:    time.Now(),
		}
		storage.Save("project-list", "session-list", cp, nil, "messages")
	}

	checkpoints, err := storage.List("project-list", "session-list")
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(checkpoints) != 3 {
		t.Errorf("Expected 3 checkpoints, got %d", len(checkpoints))
	}
}

func TestCheckpointStorage_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	storage := NewStorage(tmpDir, 3)

	checkpoint := &Checkpoint{
		ID:           "cp-delete",
		SessionID:    "session-delete",
		MessageIndex: 1,
		Timestamp:    time.Now(),
	}

	storage.Save("project-del", "session-delete", checkpoint, nil, "messages")

	err := storage.Delete("project-del", "session-delete", "cp-delete")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, _, _, err = storage.Load("project-del", "session-delete", "cp-delete")
	if err == nil {
		t.Error("Expected error loading deleted checkpoint")
	}
}

func TestCalculateHash(t *testing.T) {
	hash := CalculateHash("test content")
	if len(hash) != 64 {
		t.Errorf("Expected 64 char hash, got %d", len(hash))
	}
}
