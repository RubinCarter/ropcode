package rpc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/agentpacks"
)

func TestBuildIncludesAgentPackHandlers(t *testing.T) {
	methods := Build(&Deps{})
	for _, name := range []string{
		"ListAgentPacks",
		"InstallAgentPack",
		"CreateLocalAgentPack",
		"InstallLocalAgentPack",
		"SaveAgentPackConfig",
		"UpdateAgentPack",
	} {
		if methods[name] == nil {
			t.Fatalf("expected %s handler to be registered", name)
		}
	}
}

func TestAgentPackHandlersInstallLocal(t *testing.T) {
	root := t.TempDir()
	packDir := writeRPCPack(t, t.TempDir())
	handlers := AgentPackHandlers(&Deps{AgentPacks: agentpacks.NewManager(root)})

	params, _ := json.Marshal([]any{packDir, map[string]any{
		"agent-one": map[string]any{
			"enabled": true,
			"runtime": map[string]any{
				"provider": "codex",
				"model":    "gpt-5",
			},
		},
	}, false})
	result, err := handlers["InstallLocalAgentPack"](params)
	if err != nil {
		t.Fatalf("InstallLocalAgentPack failed: %v", err)
	}
	summary, ok := result.(*agentpacks.InstalledPackSummary)
	if !ok {
		t.Fatalf("unexpected result type: %T", result)
	}
	if summary.PackID != "ropcode.test-pack" {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if summary.Agents[0].Runtime.Provider != "codex" {
		t.Fatalf("runtime override not applied: %#v", summary.Agents[0].Runtime)
	}
}

func TestAgentPackHandlersCreateLocal(t *testing.T) {
	root := t.TempDir()
	handlers := AgentPackHandlers(&Deps{AgentPacks: agentpacks.NewManager(root)})

	params, _ := json.Marshal([]any{map[string]any{
		"name": "Commit Helper",
		"agent": map[string]any{
			"name":        "Commit Helper",
			"role_prompt": "Write focused commit messages.",
			"skills": []map[string]any{{
				"name":         "Commit Message",
				"instructions": "Summarize staged changes.",
			}},
		},
		"runtime": map[string]any{
			"provider": "claude",
			"model":    "sonnet",
		},
		"enabled": true,
	}})
	result, err := handlers["CreateLocalAgentPack"](params)
	if err != nil {
		t.Fatalf("CreateLocalAgentPack failed: %v", err)
	}
	summary, ok := result.(*agentpacks.InstalledPackSummary)
	if !ok {
		t.Fatalf("unexpected result type: %T", result)
	}
	if summary.PackID != "local.commit-helper" {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if len(summary.Agents) != 1 || summary.Agents[0].Runtime.Provider != "claude" {
		t.Fatalf("runtime override not applied: %#v", summary.Agents)
	}
}

func writeRPCPack(t *testing.T, root string) string {
	t.Helper()
	packDir := filepath.Join(root, "test-pack")
	mustWriteRPC(t, filepath.Join(packDir, "roles", "role.md"), "Role")
	mustWriteRPC(t, filepath.Join(packDir, "capabilities", "cap.md"), "Capability")
	manifest := `{
  "schema_version": 1,
  "id": "ropcode.test-pack",
  "version": "0.1.0",
  "name": "Test Pack",
  "agents": [{
    "id": "agent-one",
    "name": "Agent One",
    "role": "roles/role.md",
    "capabilities": ["capabilities/cap.md"]
  }]
}`
	mustWriteRPC(t, filepath.Join(packDir, "manifest.json"), manifest)
	return packDir
}

func mustWriteRPC(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}
