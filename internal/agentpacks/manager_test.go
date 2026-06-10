package agentpacks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallLocalPackWritesInstallConfig(t *testing.T) {
	root := t.TempDir()
	source := writeTestPack(t, t.TempDir(), "0.1.0")
	manager := NewManager(root)

	summary, err := manager.InstallLocal(source, map[string]InstalledAgentConfig{
		"memory-curator": {
			Enabled: true,
			Runtime: RuntimeConfig{
				Provider:      "codex",
				Model:         "gpt-5",
				ProviderAPIID: "api-1",
			},
			Triggers: []TriggerConfig{{
				Mode:    "manual",
				Enabled: true,
				Scope:   map[string]any{"type": "selected", "targets": []any{}},
			}},
		},
	}, false)
	if err != nil {
		t.Fatalf("InstallLocal failed: %v", err)
	}
	if summary.PackID != "ropcode.memory-curator" {
		t.Fatalf("unexpected pack id: %s", summary.PackID)
	}
	if len(summary.Agents) != 1 || summary.Agents[0].Runtime.Provider != "codex" {
		t.Fatalf("runtime config was not preserved in summary: %#v", summary.Agents)
	}

	installPath := filepath.Join(root, "agent-packs", "ropcode.memory-curator", "install.json")
	data, err := os.ReadFile(installPath)
	if err != nil {
		t.Fatalf("read install.json: %v", err)
	}
	var install InstalledPack
	if err := json.Unmarshal(data, &install); err != nil {
		t.Fatalf("parse install.json: %v", err)
	}
	got := install.Agents["memory-curator"]
	if got.Runtime.Provider != "codex" || got.Runtime.Model != "gpt-5" || got.Runtime.ProviderAPIID != "api-1" {
		t.Fatalf("unexpected install runtime: %#v", got.Runtime)
	}
	if !got.Enabled || len(got.Triggers) != 1 || !got.Triggers[0].Enabled {
		t.Fatalf("unexpected install agent config: %#v", got)
	}
}

func TestSaveInstallConfigKeepsOnlyManifestAgents(t *testing.T) {
	root := t.TempDir()
	source := writeTestPack(t, t.TempDir(), "0.1.0")
	manager := NewManager(root)
	if _, err := manager.InstallLocal(source, nil, false); err != nil {
		t.Fatalf("InstallLocal failed: %v", err)
	}

	summary, err := manager.SaveInstallConfig("ropcode.memory-curator", map[string]InstalledAgentConfig{
		"memory-curator": {
			Enabled: true,
			Runtime: RuntimeConfig{Provider: "gemini", Model: "gemini-pro"},
		},
		"unknown": {
			Enabled: true,
			Runtime: RuntimeConfig{Provider: "claude", Model: "opus"},
		},
	})
	if err != nil {
		t.Fatalf("SaveInstallConfig failed: %v", err)
	}
	if len(summary.Agents) != 1 {
		t.Fatalf("expected unknown agent to be ignored, got %#v", summary.Agents)
	}
	if summary.Agents[0].Runtime.Provider != "gemini" {
		t.Fatalf("unexpected runtime: %#v", summary.Agents[0].Runtime)
	}
}

func TestCreateLocalPackWritesRoleSkillsAndRuntime(t *testing.T) {
	root := t.TempDir()
	manager := NewManager(root)

	summary, err := manager.CreateLocal(CreateLocalPackRequest{
		Name:        "Review Helper",
		Description: "Reviews code changes.",
		Agent: ManualAgentDefinition{
			Name:       "Review Helper",
			RolePrompt: "You review code changes carefully.",
			Skills: []ManualSkill{{
				Name:         "Risk Review",
				Description:  "Use for code review risk checks.",
				Instructions: "Prioritize bugs and regressions.",
			}},
			DefaultTask: "Review the current changes.",
		},
		Runtime: RuntimeConfig{
			Provider:      "codex",
			Model:         "gpt-5",
			ProviderAPIID: "api-1",
		},
		Enabled: true,
		Triggers: []TriggerConfig{{
			Mode:     "schedule",
			Enabled:  true,
			Schedule: "0 9 * * 1-5",
			Timezone: "Asia/Shanghai",
			Scope: map[string]any{
				"type": "selected",
				"targets": []any{
					map[string]any{"type": "workspace", "path": "/repo/.ropcode/main", "name": "main"},
				},
			},
		}},
	})
	if err != nil {
		t.Fatalf("CreateLocal failed: %v", err)
	}
	if summary.PackID != "local.review-helper" {
		t.Fatalf("unexpected pack id: %s", summary.PackID)
	}
	if len(summary.Agents) != 1 || summary.Agents[0].Runtime.Provider != "codex" {
		t.Fatalf("unexpected summary agents: %#v", summary.Agents)
	}
	if !summary.Agents[0].Enabled {
		t.Fatalf("expected created agent to be enabled")
	}

	packDir := filepath.Join(root, "agent-packs", "local.review-helper")
	manifest, err := readManifest(packDir)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if manifest.Agents[0].Role != "roles/review-helper.md" {
		t.Fatalf("unexpected role path: %s", manifest.Agents[0].Role)
	}
	if len(manifest.Agents[0].Capabilities) != 1 || manifest.Agents[0].Capabilities[0] != "skills/risk-review/SKILL.md" {
		t.Fatalf("unexpected skills: %#v", manifest.Agents[0].Capabilities)
	}
	if got := manifest.Agents[0].SuggestedTriggers; len(got) != 1 || got[0].Mode != "schedule" || got[0].Schedule != "0 9 * * 1-5" || got[0].Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected suggested triggers: %#v", got)
	}
	skillContent, err := os.ReadFile(filepath.Join(packDir, "skills", "risk-review", "SKILL.md"))
	if err != nil {
		t.Fatalf("read skill: %v", err)
	}
	if !strings.Contains(string(skillContent), "name: risk-review") || !strings.Contains(string(skillContent), "description: Use for code review risk checks.") {
		t.Fatalf("unexpected skill frontmatter: %q", string(skillContent))
	}
	roleContent, err := os.ReadFile(filepath.Join(packDir, "roles", "review-helper.md"))
	if err != nil {
		t.Fatalf("read role: %v", err)
	}
	if string(roleContent) != "You review code changes carefully.\n" {
		t.Fatalf("unexpected role content: %q", string(roleContent))
	}

	install, err := readInstall(packDir)
	if err != nil {
		t.Fatalf("read install: %v", err)
	}
	if install.Source.Type != "created" {
		t.Fatalf("unexpected source: %#v", install.Source)
	}
	got := install.Agents["review-helper"]
	if got.Runtime.Provider != "codex" || got.Runtime.Model != "gpt-5" || got.Runtime.ProviderAPIID != "api-1" {
		t.Fatalf("unexpected runtime: %#v", got.Runtime)
	}
	if len(got.Triggers) != 1 || got.Triggers[0].Mode != "schedule" || got.Triggers[0].Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected install triggers: %#v", got.Triggers)
	}
}

func TestCreateLocalPackCopiesImportedSkillDirectory(t *testing.T) {
	root := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "review-skill")
	if err := os.MkdirAll(filepath.Join(sourceDir, "scripts"), 0755); err != nil {
		t.Fatalf("mkdir skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "SKILL.md"), []byte("---\nname: review-skill\ndescription: Review with helper scripts.\n---\n\n# Review Skill\n"), 0644); err != nil {
		t.Fatalf("write skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "scripts", "tool.sh"), []byte("#!/bin/sh\necho ok\n"), 0755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	manager := NewManager(root)
	summary, err := manager.CreateLocal(CreateLocalPackRequest{
		Name: "Imported Skill Agent",
		Agent: ManualAgentDefinition{
			Name:       "Imported Skill Agent",
			RolePrompt: "Use imported skills.",
			Skills: []ManualSkill{{
				Name:       "Imported Review",
				SourcePath: sourceDir,
			}},
		},
		Runtime: RuntimeConfig{Provider: "claude", Model: "sonnet"},
	})
	if err != nil {
		t.Fatalf("CreateLocal failed: %v", err)
	}
	packDir := filepath.Join(root, "agent-packs", summary.PackID)
	manifest, err := readManifest(packDir)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	if got := manifest.Agents[0].Capabilities; len(got) != 1 || got[0] != "skills/imported-review/SKILL.md" {
		t.Fatalf("unexpected capabilities: %#v", got)
	}
	if _, err := os.Stat(filepath.Join(packDir, "skills", "imported-review", "scripts", "tool.sh")); err != nil {
		t.Fatalf("expected imported script to be copied: %v", err)
	}
}

func TestListInstalledSkipsInvalidDirectories(t *testing.T) {
	root := t.TempDir()
	manager := NewManager(root)
	if _, err := manager.InstallLocal(writeTestPack(t, t.TempDir(), "0.1.0"), nil, false); err != nil {
		t.Fatalf("InstallLocal failed: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "agent-packs", "scratch"), 0755); err != nil {
		t.Fatalf("mkdir scratch: %v", err)
	}

	packs, err := manager.ListInstalled()
	if err != nil {
		t.Fatalf("ListInstalled failed: %v", err)
	}
	if len(packs) != 1 || packs[0].PackID != "ropcode.memory-curator" {
		t.Fatalf("unexpected installed packs: %#v", packs)
	}
}

func TestValidateManifestRejectsUnsafeID(t *testing.T) {
	root := t.TempDir()
	packDir := writeTestPack(t, root, "0.1.0")
	manifestPath := filepath.Join(packDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest PackManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	manifest.ID = ".."
	data, _ = json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err = NewManager(t.TempDir()).InstallLocal(packDir, nil, false)
	if err == nil {
		t.Fatal("expected unsafe manifest id to be rejected")
	}
}

func TestValidateManifestRejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	packDir := writeTestPack(t, root, "0.1.0")
	manifestPath := filepath.Join(packDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest PackManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	manifest.Agents[0].Role = "../outside.md"
	data, _ = json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err = NewManager(t.TempDir()).InstallLocal(packDir, nil, false)
	if err == nil {
		t.Fatal("expected path traversal manifest to be rejected")
	}
}

func TestValidateManifestAllowsDotsInsideFilename(t *testing.T) {
	root := t.TempDir()
	packDir := writeTestPack(t, root, "0.1.0")
	mustWrite(t, filepath.Join(packDir, "roles", "role..v2.md"), "Role with dots.")

	manifestPath := filepath.Join(packDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest PackManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("parse manifest: %v", err)
	}
	manifest.Agents[0].Role = "roles/role..v2.md"
	data, _ = json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	if _, err := NewManager(t.TempDir()).InstallLocal(packDir, nil, false); err != nil {
		t.Fatalf("expected dotted filename to be accepted: %v", err)
	}
}

func writeTestPack(t *testing.T, root, version string) string {
	t.Helper()
	packDir := filepath.Join(root, "memory-curator")
	mustMkdir(t, filepath.Join(packDir, "roles"))
	mustMkdir(t, filepath.Join(packDir, "capabilities"))
	mustWrite(t, filepath.Join(packDir, "roles", "memory-curator.md"), "You curate durable memory.")
	mustWrite(t, filepath.Join(packDir, "capabilities", "memory.md"), "Extract durable facts.")

	manifest := PackManifest{
		SchemaVersion: 1,
		ID:            "ropcode.memory-curator",
		Version:       version,
		Name:          "Memory Curator",
		Description:   "Curates durable project memory.",
		Agents: []AgentDefinition{{
			ID:           "memory-curator",
			Name:         "Memory Curator",
			Icon:         "brain",
			Role:         "roles/memory-curator.md",
			Capabilities: []string{"capabilities/memory.md"},
			DefaultTask:  "Extract durable memory.",
			SuggestedTriggers: []TriggerTemplate{{
				Mode: "on_session_complete",
			}},
		}},
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWrite(t, filepath.Join(packDir, "manifest.json"), string(data))
	return packDir
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
