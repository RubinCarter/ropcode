package codex

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/provider"
)

func TestSaveProviderCapabilityWritesCodexPrompt(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	driver := &Driver{}
	err := driver.SaveProviderCapability(context.Background(), provider.Capability{
		Name:    "test-prompt",
		Kind:    string(provider.CapabilityKindCommand),
		Scope:   string(provider.CapabilityScopeUser),
		Content: "prompt body",
	}, "")
	if err != nil {
		t.Fatalf("SaveProviderCapability failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(home, ".codex", "prompts", "test-prompt.md"))
	if err != nil {
		t.Fatalf("expected prompt file: %v", err)
	}
	if string(content) != "prompt body" {
		t.Fatalf("unexpected content: %q", string(content))
	}
}

func TestDeleteProviderCapabilityRemovesCodexProjectPrompt(t *testing.T) {
	projectPath := t.TempDir()
	promptDir := filepath.Join(projectPath, ".codex", "prompts")
	if err := os.MkdirAll(promptDir, 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(promptDir, "project-prompt.md"), []byte("body"), 0644); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	driver := &Driver{}
	err := driver.DeleteProviderCapability(context.Background(), provider.Capability{
		Name:  "project-prompt",
		Kind:  string(provider.CapabilityKindCommand),
		Scope: string(provider.CapabilityScopeProject),
	}, projectPath)
	if err != nil {
		t.Fatalf("DeleteProviderCapability failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(promptDir, "project-prompt.md")); !os.IsNotExist(err) {
		t.Fatalf("expected prompt file to be removed, stat err=%v", err)
	}
}
