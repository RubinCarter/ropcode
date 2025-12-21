package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestGetHooks(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "claude-hooks-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create settings.json with hooks
	settingsPath := filepath.Join(tmpDir, "settings.json")
	settings := map[string]interface{}{
		"hooks": map[string]interface{}{
			"PreToolUse": []map[string]interface{}{
				{
					"matcher": "Edit|Write",
					"hooks": []map[string]interface{}{
						{
							"type":    "command",
							"command": "echo 'editing'",
						},
					},
				},
			},
			"PostToolUse": []map[string]interface{}{
				{
					"matcher": ".*",
					"hooks": []map[string]interface{}{
						{
							"type":    "command",
							"command": "echo 'done'",
						},
					},
				},
			},
		},
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal settings: %v", err)
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("Failed to write settings: %v", err)
	}

	// Test GetHooks
	hooks, err := GetHooks(tmpDir)
	if err != nil {
		t.Fatalf("GetHooks failed: %v", err)
	}

	if len(hooks.PreToolUse) != 1 {
		t.Errorf("Expected 1 PreToolUse hook, got %d", len(hooks.PreToolUse))
	}

	if hooks.PreToolUse[0].Matcher != "Edit|Write" {
		t.Errorf("Expected matcher 'Edit|Write', got '%s'", hooks.PreToolUse[0].Matcher)
	}

	if len(hooks.PreToolUse[0].Hooks) != 1 {
		t.Errorf("Expected 1 hook in PreToolUse, got %d", len(hooks.PreToolUse[0].Hooks))
	}

	if hooks.PreToolUse[0].Hooks[0].Type != "command" {
		t.Errorf("Expected hook type 'command', got '%s'", hooks.PreToolUse[0].Hooks[0].Type)
	}

	if hooks.PreToolUse[0].Hooks[0].Command != "echo 'editing'" {
		t.Errorf("Expected command 'echo 'editing'', got '%s'", hooks.PreToolUse[0].Hooks[0].Command)
	}

	if len(hooks.PostToolUse) != 1 {
		t.Errorf("Expected 1 PostToolUse hook, got %d", len(hooks.PostToolUse))
	}
}

func TestGetHooksEmptySettings(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "claude-hooks-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create empty settings.json
	settingsPath := filepath.Join(tmpDir, "settings.json")
	settings := map[string]interface{}{}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal settings: %v", err)
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("Failed to write settings: %v", err)
	}

	// Test GetHooks
	hooks, err := GetHooks(tmpDir)
	if err != nil {
		t.Fatalf("GetHooks failed: %v", err)
	}

	if hooks == nil {
		t.Fatal("Expected non-nil hooks")
	}

	if len(hooks.PreToolUse) != 0 {
		t.Errorf("Expected 0 PreToolUse hooks, got %d", len(hooks.PreToolUse))
	}
}

func TestSaveHooks(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "claude-hooks-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create initial settings
	settingsPath := filepath.Join(tmpDir, "settings.json")
	settings := map[string]interface{}{
		"other_setting": "value",
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal settings: %v", err)
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("Failed to write settings: %v", err)
	}

	// Create hooks to save
	hooks := &HooksConfig{
		PreToolUse: []HookMatcher{
			{
				Matcher: "Edit|Write",
				Hooks: []Hook{
					{
						Type:    "command",
						Command: "echo 'test'",
					},
				},
			},
		},
		Stop: []HookMatcher{
			{
				Matcher: ".*",
				Hooks: []Hook{
					{
						Type:   "script",
						Script: "/path/to/script.sh",
					},
				},
			},
		},
	}

	// Test SaveHooks
	if err := SaveHooks(tmpDir, hooks); err != nil {
		t.Fatalf("SaveHooks failed: %v", err)
	}

	// Verify the hooks were saved
	savedHooks, err := GetHooks(tmpDir)
	if err != nil {
		t.Fatalf("GetHooks failed: %v", err)
	}

	if len(savedHooks.PreToolUse) != 1 {
		t.Errorf("Expected 1 PreToolUse hook, got %d", len(savedHooks.PreToolUse))
	}

	if savedHooks.PreToolUse[0].Matcher != "Edit|Write" {
		t.Errorf("Expected matcher 'Edit|Write', got '%s'", savedHooks.PreToolUse[0].Matcher)
	}

	if len(savedHooks.Stop) != 1 {
		t.Errorf("Expected 1 Stop hook, got %d", len(savedHooks.Stop))
	}

	if savedHooks.Stop[0].Hooks[0].Script != "/path/to/script.sh" {
		t.Errorf("Expected script '/path/to/script.sh', got '%s'", savedHooks.Stop[0].Hooks[0].Script)
	}

	// Verify other settings were preserved
	loadedSettings, err := LoadSettings(settingsPath)
	if err != nil {
		t.Fatalf("LoadSettings failed: %v", err)
	}

	if loadedSettings["other_setting"] != "value" {
		t.Errorf("Expected other_setting to be preserved")
	}
}

func TestGetHooksByType(t *testing.T) {
	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "claude-hooks-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create settings with multiple hook types
	settingsPath := filepath.Join(tmpDir, "settings.json")
	settings := map[string]interface{}{
		"hooks": map[string]interface{}{
			"PreToolUse": []map[string]interface{}{
				{
					"matcher": "Edit",
					"hooks": []map[string]interface{}{
						{"type": "command", "command": "pre-edit"},
					},
				},
			},
			"PostToolUse": []map[string]interface{}{
				{
					"matcher": "Edit",
					"hooks": []map[string]interface{}{
						{"type": "command", "command": "post-edit"},
					},
				},
			},
			"Notification": []map[string]interface{}{
				{
					"matcher": ".*",
					"hooks": []map[string]interface{}{
						{"type": "command", "command": "notify"},
					},
				},
			},
			"Stop": []map[string]interface{}{
				{
					"matcher": ".*",
					"hooks": []map[string]interface{}{
						{"type": "command", "command": "cleanup"},
					},
				},
			},
		},
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal settings: %v", err)
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		t.Fatalf("Failed to write settings: %v", err)
	}

	// Test each hook type
	testCases := []struct {
		hookType string
		expected string
	}{
		{"PreToolUse", "pre-edit"},
		{"PostToolUse", "post-edit"},
		{"Notification", "notify"},
		{"Stop", "cleanup"},
	}

	for _, tc := range testCases {
		t.Run(tc.hookType, func(t *testing.T) {
			hooks, err := GetHooksByType(tmpDir, tc.hookType)
			if err != nil {
				t.Fatalf("GetHooksByType(%s) failed: %v", tc.hookType, err)
			}

			if len(hooks) != 1 {
				t.Errorf("Expected 1 hook for %s, got %d", tc.hookType, len(hooks))
			}

			if len(hooks) > 0 && len(hooks[0].Hooks) > 0 {
				if hooks[0].Hooks[0].Command != tc.expected {
					t.Errorf("Expected command '%s' for %s, got '%s'", tc.expected, tc.hookType, hooks[0].Hooks[0].Command)
				}
			}
		})
	}

	// Test invalid hook type
	hooks, err := GetHooksByType(tmpDir, "InvalidType")
	if err != nil {
		t.Fatalf("GetHooksByType with invalid type failed: %v", err)
	}

	if len(hooks) != 0 {
		t.Errorf("Expected 0 hooks for invalid type, got %d", len(hooks))
	}
}
