// internal/config/config_test.go
package config

import (
	"os"
	"testing"
)

func TestConfig_Load(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if cfg.HomeDir == "" {
		t.Error("HomeDir should not be empty")
	}

	if cfg.RopcodeDir == "" {
		t.Error("RopcodeDir should not be empty")
	}

	// Verify RopcodeDir exists
	if _, err := os.Stat(cfg.RopcodeDir); os.IsNotExist(err) {
		t.Error("RopcodeDir should be created")
	}
}

func TestConfig_GetProjectPath(t *testing.T) {
	cfg, _ := Load()

	path := cfg.GetProjectPath("/home/user/myproject")
	expected := "/home/user/myproject/.claude"

	if path != expected {
		t.Errorf("Expected %s, got %s", expected, path)
	}
}
