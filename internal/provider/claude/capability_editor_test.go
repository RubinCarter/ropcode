package claude

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/provider"
)

func TestSaveProviderCapabilityWritesClaudeCommand(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	driver := &Driver{}
	err := driver.SaveProviderCapability(context.Background(), provider.Capability{
		Name:    "test-command",
		Kind:    string(provider.CapabilityKindCommand),
		Scope:   string(provider.CapabilityScopeUser),
		Content: "test body",
	}, "")
	if err != nil {
		t.Fatalf("SaveProviderCapability failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(home, ".claude", "commands", "test-command.md"))
	if err != nil {
		t.Fatalf("expected command file: %v", err)
	}
	if string(content) != "test body" {
		t.Fatalf("unexpected content: %q", string(content))
	}
}

func TestDeleteProviderCapabilityRemovesClaudeProjectCommand(t *testing.T) {
	projectPath := t.TempDir()
	commandDir := filepath.Join(projectPath, ".claude", "commands")
	if err := os.MkdirAll(commandDir, 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(commandDir, "project-command.md"), []byte("body"), 0644); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	driver := &Driver{}
	err := driver.DeleteProviderCapability(context.Background(), provider.Capability{
		Name:  "project-command",
		Kind:  string(provider.CapabilityKindCommand),
		Scope: string(provider.CapabilityScopeProject),
	}, projectPath)
	if err != nil {
		t.Fatalf("DeleteProviderCapability failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(commandDir, "project-command.md")); !os.IsNotExist(err) {
		t.Fatalf("expected command file to be removed, stat err=%v", err)
	}
}
