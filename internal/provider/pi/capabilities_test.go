package pi

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/provider"
)

func TestDiscoverProviderCapabilitiesLoadsPiFilesystemCapabilities(t *testing.T) {
	piDir := t.TempDir()
	projectPath := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", piDir)

	writeCapabilityFile(t, filepath.Join(piDir, "commands", "ask.md"), "Ask command")
	writeCapabilityFile(t, filepath.Join(piDir, "agents", "researcher.md"), "Research agent")
	writeCapabilityFile(t, filepath.Join(piDir, "skills", "video", "SKILL.md"), "---\ndescription: Video skill\n---\nSkill body")
	writeCapabilityFile(t, filepath.Join(projectPath, ".pi", "agent", "skills", "project", "SKILL.md"), "Project skill")

	layers, err := (&Driver{}).DiscoverProviderCapabilities(context.Background(), projectPath, false)
	if err != nil {
		t.Fatalf("DiscoverProviderCapabilities failed: %v", err)
	}

	assertCapability(t, layers.AllVisible, "command", "/ask", "user")
	assertCapability(t, layers.AllVisible, "agent", "/researcher", "user")
	assertCapability(t, layers.AllVisible, "skill", "/video", "user")
	assertCapability(t, layers.AllVisible, "skill", "/project", "project")
}

func writeCapabilityFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir %s failed: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s failed: %v", path, err)
	}
}

func assertCapability(t *testing.T, capabilities []provider.Capability, kind, slashName, scope string) {
	t.Helper()
	for _, capability := range capabilities {
		if capability.Kind == kind && capability.SlashName == slashName && capability.Scope == scope {
			return
		}
	}
	t.Fatalf("missing capability kind=%s slash=%s scope=%s in %#v", kind, slashName, scope, capabilities)
}
