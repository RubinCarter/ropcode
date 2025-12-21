// internal/checkpoint/manager_test.go
package checkpoint

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCheckpointManager(t *testing.T) {
	// Create temp directory for testing
	tempDir, err := os.MkdirTemp("", "checkpoint_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	storage := NewStorage(tempDir, 3)
	manager := NewManager(storage, "test-project")

	t.Run("GetOrCreateSession", func(t *testing.T) {
		session := manager.GetOrCreateSession("session-1")
		if session.SessionID != "session-1" {
			t.Errorf("Expected session ID 'session-1', got '%s'", session.SessionID)
		}

		if session.Config.CheckpointStrategy != "manual" {
			t.Errorf("Expected default strategy 'manual', got '%s'", session.Config.CheckpointStrategy)
		}
	})

	t.Run("TrackMessage", func(t *testing.T) {
		err := manager.TrackMessage("session-1", 5)
		if err != nil {
			t.Errorf("TrackMessage failed: %v", err)
		}

		session := manager.GetOrCreateSession("session-1")
		if session.MessageCount != 5 {
			t.Errorf("Expected message count 5, got %d", session.MessageCount)
		}
	})

	t.Run("UpdateConfig", func(t *testing.T) {
		config := &CheckpointConfig{
			AutoCheckpointEnabled: true,
			CheckpointStrategy:    "auto",
			MaxCheckpoints:        30,
			CheckpointInterval:    5,
		}

		err := manager.UpdateConfig("session-1", config)
		if err != nil {
			t.Errorf("UpdateConfig failed: %v", err)
		}

		session := manager.GetOrCreateSession("session-1")
		if !session.Config.AutoCheckpointEnabled {
			t.Error("Expected auto checkpoint to be enabled")
		}
		if session.Config.CheckpointInterval != 5 {
			t.Errorf("Expected interval 5, got %d", session.Config.CheckpointInterval)
		}
	})

	t.Run("ShouldAutoCheckpoint", func(t *testing.T) {
		// Set up session with auto checkpoint enabled
		config := &CheckpointConfig{
			AutoCheckpointEnabled: true,
			CheckpointStrategy:    "auto",
			MaxCheckpoints:        30,
			CheckpointInterval:    5,
		}
		manager.UpdateConfig("session-2", config)

		// Track 5 messages
		manager.TrackMessage("session-2", 5)

		// Should trigger auto checkpoint
		should, err := manager.ShouldAutoCheckpoint("session-2")
		if err != nil {
			t.Errorf("ShouldAutoCheckpoint failed: %v", err)
		}
		if !should {
			t.Error("Expected auto checkpoint to be triggered")
		}
	})

	t.Run("ClearSession", func(t *testing.T) {
		manager.GetOrCreateSession("session-3")
		err := manager.ClearSession("session-3")
		if err != nil {
			t.Errorf("ClearSession failed: %v", err)
		}

		// Session should be recreated with defaults
		session := manager.GetOrCreateSession("session-3")
		if session.MessageCount != 0 {
			t.Errorf("Expected message count 0 after clear, got %d", session.MessageCount)
		}
	})
}

func TestRestoreCheckpoint(t *testing.T) {
	// Create temp directory for testing
	tempDir, err := os.MkdirTemp("", "checkpoint_restore_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Create a test file to checkpoint
	testFileDir := filepath.Join(tempDir, "test_files")
	os.MkdirAll(testFileDir, 0755)
	testFile := filepath.Join(testFileDir, "test.txt")
	originalContent := "original content"
	os.WriteFile(testFile, []byte(originalContent), 0644)

	storage := NewStorage(tempDir, 3)
	manager := NewManager(storage, "test-project")

	// Create a checkpoint
	cp := &Checkpoint{
		ID:           GenerateID(),
		SessionID:    "session-1",
		MessageIndex: 1,
		Description:  "Test checkpoint",
		TriggerType:  "manual",
	}

	files := []FileSnapshot{
		{
			CheckpointID: cp.ID,
			FilePath:     testFile,
			Content:      originalContent,
			Hash:         CalculateHash(originalContent),
			Size:         int64(len(originalContent)),
			Permissions:  0644,
		},
	}

	_, err = storage.Save("test-project", "session-1", cp, files, "[]")
	if err != nil {
		t.Fatalf("Failed to save checkpoint: %v", err)
	}

	// Modify the file
	modifiedContent := "modified content"
	os.WriteFile(testFile, []byte(modifiedContent), 0644)

	// Restore checkpoint
	opts := map[string]interface{}{
		"restore_files": true,
	}

	result, err := manager.RestoreCheckpoint("test-project", "session-1", cp.ID, opts)
	if err != nil {
		t.Fatalf("RestoreCheckpoint failed: %v", err)
	}

	if result.FilesProcessed != 1 {
		t.Errorf("Expected 1 file processed, got %d", result.FilesProcessed)
	}

	// Verify file was restored
	restoredContent, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("Failed to read restored file: %v", err)
	}

	if string(restoredContent) != originalContent {
		t.Errorf("Expected restored content '%s', got '%s'", originalContent, string(restoredContent))
	}
}

func TestGetTimeline(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "checkpoint_timeline_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	storage := NewStorage(tempDir, 3)
	manager := NewManager(storage, "test-project")

	// Create multiple checkpoints
	cp1 := &Checkpoint{
		ID:           GenerateID(),
		SessionID:    "session-1",
		MessageIndex: 1,
		Description:  "First checkpoint",
		TriggerType:  "manual",
	}

	cp2 := &Checkpoint{
		ID:                 GenerateID(),
		SessionID:          "session-1",
		ParentCheckpointID: cp1.ID,
		MessageIndex:       2,
		Description:        "Second checkpoint",
		TriggerType:        "manual",
	}

	storage.Save("test-project", "session-1", cp1, []FileSnapshot{}, "[]")
	storage.Save("test-project", "session-1", cp2, []FileSnapshot{}, "[]")

	// Get timeline
	timeline, err := manager.GetTimeline("test-project", "session-1")
	if err != nil {
		t.Fatalf("GetTimeline failed: %v", err)
	}

	if timeline.TotalCheckpoints != 2 {
		t.Errorf("Expected 2 checkpoints, got %d", timeline.TotalCheckpoints)
	}

	if timeline.RootNode == nil {
		t.Error("Expected root node to be set")
	}
}

func TestGetDiff(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "checkpoint_diff_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	storage := NewStorage(tempDir, 3)
	manager := NewManager(storage, "test-project")

	// Create two checkpoints with different files
	cp1 := &Checkpoint{
		ID:           GenerateID(),
		SessionID:    "session-1",
		MessageIndex: 1,
		TriggerType:  "manual",
	}

	files1 := []FileSnapshot{
		{
			CheckpointID: cp1.ID,
			FilePath:     "/test/file1.txt",
			Content:      "content1",
			Hash:         CalculateHash("content1"),
			Size:         8,
		},
		{
			CheckpointID: cp1.ID,
			FilePath:     "/test/file2.txt",
			Content:      "content2",
			Hash:         CalculateHash("content2"),
			Size:         8,
		},
	}

	cp2 := &Checkpoint{
		ID:           GenerateID(),
		SessionID:    "session-1",
		MessageIndex: 2,
		TriggerType:  "manual",
	}

	files2 := []FileSnapshot{
		{
			CheckpointID: cp2.ID,
			FilePath:     "/test/file1.txt",
			Content:      "modified content1",
			Hash:         CalculateHash("modified content1"),
			Size:         17,
		},
		{
			CheckpointID: cp2.ID,
			FilePath:     "/test/file3.txt",
			Content:      "content3",
			Hash:         CalculateHash("content3"),
			Size:         8,
		},
	}

	storage.Save("test-project", "session-1", cp1, files1, "[]")
	storage.Save("test-project", "session-1", cp2, files2, "[]")

	// Get diff
	diff, err := manager.GetDiff("test-project", "session-1", cp1.ID, cp2.ID)
	if err != nil {
		t.Fatalf("GetDiff failed: %v", err)
	}

	modified := diff["modified_files"].([]map[string]interface{})
	added := diff["added_files"].([]map[string]interface{})
	deleted := diff["deleted_files"].([]map[string]interface{})

	if len(modified) != 1 {
		t.Errorf("Expected 1 modified file, got %d", len(modified))
	}
	if len(added) != 1 {
		t.Errorf("Expected 1 added file, got %d", len(added))
	}
	if len(deleted) != 1 {
		t.Errorf("Expected 1 deleted file, got %d", len(deleted))
	}
}
