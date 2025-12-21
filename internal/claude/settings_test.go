package claude

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettings_Load(t *testing.T) {
	tmpDir := t.TempDir()
	settingsPath := filepath.Join(tmpDir, "settings.json")

	// Create test settings file
	os.WriteFile(settingsPath, []byte(`{"theme": "dark"}`), 0644)

	settings, err := LoadSettings(settingsPath)
	if err != nil {
		t.Fatalf("LoadSettings failed: %v", err)
	}

	if settings["theme"] != "dark" {
		t.Errorf("Expected theme 'dark', got '%v'", settings["theme"])
	}
}

func TestSettings_LoadNonExistent(t *testing.T) {
	settings, err := LoadSettings("/nonexistent/path/settings.json")
	if err != nil {
		t.Fatalf("LoadSettings should not fail for non-existent file: %v", err)
	}
	if len(settings) != 0 {
		t.Error("Expected empty settings for non-existent file")
	}
}

func TestSettings_Save(t *testing.T) {
	tmpDir := t.TempDir()
	settingsPath := filepath.Join(tmpDir, "settings.json")

	settings := map[string]interface{}{
		"theme": "light",
		"model": "sonnet",
	}

	err := SaveSettings(settingsPath, settings)
	if err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	// Verify
	loaded, _ := LoadSettings(settingsPath)
	if loaded["theme"] != "light" {
		t.Errorf("Expected theme 'light', got '%v'", loaded["theme"])
	}
}

func TestSystemPrompt(t *testing.T) {
	tmpDir := t.TempDir()

	// Test save
	err := SaveSystemPrompt(tmpDir, "# Test Prompt")
	if err != nil {
		t.Fatalf("SaveSystemPrompt failed: %v", err)
	}

	// Test load
	content, err := GetSystemPrompt(tmpDir)
	if err != nil {
		t.Fatalf("GetSystemPrompt failed: %v", err)
	}
	if content != "# Test Prompt" {
		t.Errorf("Expected '# Test Prompt', got '%s'", content)
	}
}

func TestFindClaudeMdFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create CLAUDE.md in root
	os.WriteFile(filepath.Join(tmpDir, "CLAUDE.md"), []byte("root"), 0644)

	// Create .claude directory with md files
	claudeDir := filepath.Join(tmpDir, ".claude")
	os.MkdirAll(claudeDir, 0755)
	os.WriteFile(filepath.Join(claudeDir, "commands.md"), []byte("commands"), 0644)

	files, err := FindClaudeMdFiles(tmpDir)
	if err != nil {
		t.Fatalf("FindClaudeMdFiles failed: %v", err)
	}

	if len(files) != 2 {
		t.Errorf("Expected 2 files, got %d", len(files))
	}
}
