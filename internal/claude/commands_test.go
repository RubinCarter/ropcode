package claude

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSlashCommands(t *testing.T) {
	// Create temporary directories for testing
	tmpDir := t.TempDir()
	globalDir := filepath.Join(tmpDir, ".claude", "commands")
	projectDir := filepath.Join(tmpDir, "project", ".claude", "commands")

	// Create directories
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatalf("Failed to create global commands dir: %v", err)
	}
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatalf("Failed to create project commands dir: %v", err)
	}

	// Override home directory for testing
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", originalHome)

	projectPath := filepath.Join(tmpDir, "project")

	t.Run("SaveAndGetGlobalCommand", func(t *testing.T) {
		// Save a global command
		err := SaveSlashCommand("test-global", "# Test Global Command\nThis is a test.", "global", "")
		if err != nil {
			t.Fatalf("Failed to save global command: %v", err)
		}

		// Get the command
		cmd, err := GetSlashCommand("test-global", "")
		if err != nil {
			t.Fatalf("Failed to get global command: %v", err)
		}

		if cmd.Name != "test-global" {
			t.Errorf("Expected name 'test-global', got '%s'", cmd.Name)
		}
		if cmd.Scope != "global" {
			t.Errorf("Expected scope 'global', got '%s'", cmd.Scope)
		}
		if cmd.Content != "# Test Global Command\nThis is a test." {
			t.Errorf("Content mismatch: %s", cmd.Content)
		}
	})

	t.Run("SaveAndGetProjectCommand", func(t *testing.T) {
		// Save a project command
		err := SaveSlashCommand("test-project", "# Test Project Command\nProject specific.", "project", projectPath)
		if err != nil {
			t.Fatalf("Failed to save project command: %v", err)
		}

		// Get the command
		cmd, err := GetSlashCommand("test-project", projectPath)
		if err != nil {
			t.Fatalf("Failed to get project command: %v", err)
		}

		if cmd.Name != "test-project" {
			t.Errorf("Expected name 'test-project', got '%s'", cmd.Name)
		}
		if cmd.Scope != "project" {
			t.Errorf("Expected scope 'project', got '%s'", cmd.Scope)
		}
	})

	t.Run("ListCommands", func(t *testing.T) {
		// List all commands
		commands, err := ListSlashCommands(projectPath)
		if err != nil {
			t.Fatalf("Failed to list commands: %v", err)
		}

		if len(commands) != 2 {
			t.Errorf("Expected 2 commands, got %d", len(commands))
		}

		// Verify we have both global and project commands
		hasGlobal := false
		hasProject := false
		for _, cmd := range commands {
			if cmd.Name == "test-global" && cmd.Scope == "global" {
				hasGlobal = true
			}
			if cmd.Name == "test-project" && cmd.Scope == "project" {
				hasProject = true
			}
		}

		if !hasGlobal {
			t.Error("Global command not found in list")
		}
		if !hasProject {
			t.Error("Project command not found in list")
		}
	})

	t.Run("DeleteGlobalCommand", func(t *testing.T) {
		// Delete global command
		err := DeleteSlashCommand("test-global", "global", "")
		if err != nil {
			t.Fatalf("Failed to delete global command: %v", err)
		}

		// Verify it's deleted
		_, err = GetSlashCommand("test-global", "")
		if err == nil {
			t.Error("Expected error when getting deleted command")
		}
	})

	t.Run("DeleteProjectCommand", func(t *testing.T) {
		// Delete project command
		err := DeleteSlashCommand("test-project", "project", projectPath)
		if err != nil {
			t.Fatalf("Failed to delete project command: %v", err)
		}

		// Verify it's deleted
		_, err = GetSlashCommand("test-project", projectPath)
		if err == nil {
			t.Error("Expected error when getting deleted command")
		}
	})

	t.Run("InvalidScope", func(t *testing.T) {
		// Try to save with invalid scope
		err := SaveSlashCommand("test", "content", "invalid", "")
		if err == nil {
			t.Error("Expected error for invalid scope")
		}
	})

	t.Run("EmptyName", func(t *testing.T) {
		// Try to save with empty name
		err := SaveSlashCommand("", "content", "global", "")
		if err == nil {
			t.Error("Expected error for empty name")
		}
	})

	t.Run("ProjectScopeWithoutPath", func(t *testing.T) {
		// Try to save project command without project path
		err := SaveSlashCommand("test", "content", "project", "")
		if err == nil {
			t.Error("Expected error for project scope without path")
		}
	})
}
