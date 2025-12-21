// internal/provider/claude_test.go
package provider

import (
	"context"
	"testing"
)

func TestClaudeProvider_ID(t *testing.T) {
	provider := NewClaudeProvider("")

	if provider.ID() != "claude" {
		t.Errorf("Expected ID 'claude', got '%s'", provider.ID())
	}
}

func TestClaudeProvider_Name(t *testing.T) {
	provider := NewClaudeProvider("")

	if provider.Name() != "Claude Code" {
		t.Errorf("Expected Name 'Claude Code', got '%s'", provider.Name())
	}
}

func TestClaudeProvider_SupportedModels(t *testing.T) {
	provider := NewClaudeProvider("")
	models := provider.SupportedModels()

	if len(models) == 0 {
		t.Error("Expected at least one supported model")
	}

	// Check for sonnet
	foundSonnet := false
	foundOpus := false
	foundHaiku := false

	for _, m := range models {
		switch m.ID {
		case "sonnet":
			foundSonnet = true
		case "opus":
			foundOpus = true
		case "haiku":
			foundHaiku = true
		}
	}

	if !foundSonnet {
		t.Error("Expected 'sonnet' model to be supported")
	}
	if !foundOpus {
		t.Error("Expected 'opus' model to be supported")
	}
	if !foundHaiku {
		t.Error("Expected 'haiku' model to be supported")
	}
}

func TestClaudeProvider_DiscoverInstallations(t *testing.T) {
	provider := NewClaudeProvider("")
	installations, err := provider.DiscoverInstallations()

	if err != nil {
		t.Fatalf("DiscoverInstallations failed: %v", err)
	}

	// We can't guarantee an installation exists, so just check the call succeeds
	// and returns a slice (even if empty)
	if installations == nil {
		t.Error("Expected installations slice, got nil")
	}
}

func TestClaudeProvider_StartSession(t *testing.T) {
	provider := NewClaudeProvider("")
	ctx := context.Background()

	config := SessionConfig{
		ProjectPath: "/tmp/test-project",
		Prompt:      "test prompt",
		Model:       "sonnet",
	}

	// This will fail if claude is not installed, which is expected in test
	// We just want to verify the method exists and has correct signature
	err := provider.StartSession(ctx, config)

	// We expect an error if claude is not installed
	// The important thing is the method exists and compiles
	_ = err // Acknowledge we got an error, that's ok for this test
}

func TestClaudeProvider_TerminateSession(t *testing.T) {
	provider := NewClaudeProvider("")
	ctx := context.Background()

	// Just verify the method exists and compiles
	err := provider.TerminateSession(ctx, "/tmp/test-project")

	// Method should exist and return
	_ = err
}
