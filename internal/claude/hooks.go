package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Hook represents a single hook action (command or script)
type Hook struct {
	Type    string `json:"type"`              // "command" or "script"
	Command string `json:"command,omitempty"` // Command to execute
	Script  string `json:"script,omitempty"`  // Script path to execute
}

// HookMatcher represents a hook matcher with its associated hooks
type HookMatcher struct {
	Matcher string `json:"matcher"` // Regex pattern to match tool names
	Hooks   []Hook `json:"hooks"`   // List of hooks to execute
}

// HooksConfig represents the complete hooks configuration
type HooksConfig struct {
	PreToolUse   []HookMatcher `json:"PreToolUse,omitempty"`
	PostToolUse  []HookMatcher `json:"PostToolUse,omitempty"`
	Notification []HookMatcher `json:"Notification,omitempty"`
	Stop         []HookMatcher `json:"Stop,omitempty"`
}

// GetHooks loads all hooks from ~/.claude/settings.json
func GetHooks(claudeDir string) (*HooksConfig, error) {
	settingsPath := filepath.Join(claudeDir, "settings.json")

	// Load settings
	settings, err := LoadSettings(settingsPath)
	if err != nil {
		return nil, err
	}

	// Extract hooks from settings
	hooksData, ok := settings["hooks"]
	if !ok {
		// Return empty hooks config if not present
		return &HooksConfig{}, nil
	}

	// Marshal and unmarshal to convert map to struct
	hooksJSON, err := json.Marshal(hooksData)
	if err != nil {
		return nil, err
	}

	var hooks HooksConfig
	if err := json.Unmarshal(hooksJSON, &hooks); err != nil {
		return nil, err
	}

	return &hooks, nil
}

// SaveHooks saves the hooks configuration to ~/.claude/settings.json
func SaveHooks(claudeDir string, hooks *HooksConfig) error {
	settingsPath := filepath.Join(claudeDir, "settings.json")

	// Load existing settings
	settings, err := LoadSettings(settingsPath)
	if err != nil {
		return err
	}

	// Update hooks field
	settings["hooks"] = hooks

	// Save settings back
	return SaveSettings(settingsPath, settings)
}

// GetHooksByType retrieves hooks for a specific type
func GetHooksByType(claudeDir string, hookType string) ([]HookMatcher, error) {
	hooks, err := GetHooks(claudeDir)
	if err != nil {
		return nil, err
	}

	switch hookType {
	case "PreToolUse":
		return hooks.PreToolUse, nil
	case "PostToolUse":
		return hooks.PostToolUse, nil
	case "Notification":
		return hooks.Notification, nil
	case "Stop":
		return hooks.Stop, nil
	default:
		return []HookMatcher{}, nil
	}
}

// EnsureClaudeDir ensures the ~/.claude directory exists
func EnsureClaudeDir(claudeDir string) error {
	return os.MkdirAll(claudeDir, 0755)
}
