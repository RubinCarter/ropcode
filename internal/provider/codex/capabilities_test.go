package codex

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/provider"
)

func TestDiscoverProviderCapabilitiesLoadsCodexCommandsAgentsAndSkills(t *testing.T) {
	codexDir := t.TempDir()
	homeDir := t.TempDir()
	projectPath := t.TempDir()
	t.Setenv("CODEX_HOME", codexDir)
	t.Setenv("HOME", homeDir)
	restoreCapabilities := stubCodexAppServerCapabilities(func(ctx context.Context, binaryPath, providerID, projectPath string, force bool) ([]provider.Capability, error) {
		return nil, nil
	})
	defer restoreCapabilities()
	restoreBinary := stubCodexBinary("/tmp/codex")
	defer restoreBinary()

	writeCapabilityFile(t, filepath.Join(codexDir, "prompts", "code-review.md"), "---\ndescription: Review code\n---\nReview body")
	writeCapabilityFile(t, filepath.Join(codexDir, "agents", "researcher.md"), "---\ndescription: Research agent\n---\nAgent body")
	writeCapabilityFile(t, filepath.Join(codexDir, "skills", "video", "SKILL.md"), "---\nname: video\ndescription: Video skill\n---\nSkill body")
	writeCapabilityFile(t, filepath.Join(codexDir, "skills", ".system", "imagegen", "SKILL.md"), "---\nname: imagegen\ndescription: Image generation skill\n---\nSkill body")
	writeCapabilityFile(t, filepath.Join(homeDir, ".agents", "skills", "canvas", "SKILL.md"), "---\nname: canvas-design\ndescription: Canvas design skill\n---\nSkill body")
	writeCapabilityFile(t, filepath.Join(projectPath, ".codex", "prompts", "project.md"), "Project prompt")
	writeCapabilityFile(t, filepath.Join(projectPath, ".codex", "skills", "project-skill", "SKILL.md"), "---\ndescription: Project skill\n---\nSkill body")

	layers, err := (&Driver{}).DiscoverProviderCapabilities(context.Background(), projectPath, false)
	if err != nil {
		t.Fatalf("DiscoverProviderCapabilities failed: %v", err)
	}

	assertCapability(t, layers.AllVisible, "command", "/code-review", "user")
	assertCapability(t, layers.AllVisible, "agent", "/researcher", "user")
	assertCapability(t, layers.AllVisible, "skill", "/video", "user")
	assertCapability(t, layers.AllVisible, "skill", "/imagegen", "system")
	assertCapability(t, layers.AllVisible, "skill", "/canvas-design", "user")
	assertCapability(t, layers.AllVisible, "command", "/project", "project")
	assertCapability(t, layers.AllVisible, "skill", "/project-skill", "project")
	assertCapability(t, layers.AllVisible, "command", "/model", "system")
	assertCapability(t, layers.AllVisible, "command", "/permissions", "system")
}

func TestCodexBuiltinSlashCommandsMatchTUICommands(t *testing.T) {
	capabilities := codexBuiltinSlashCommands("codex")
	expected := []string{
		"/model",
		"/ide",
		"/permissions",
		"/keymap",
		"/vim",
		"/experimental",
		"/approve",
		"/status",
		"/clear",
	}

	for _, slashName := range expected {
		assertCapability(t, capabilities, "command", slashName, "system")
	}
}

func TestDiscoverProviderCapabilitiesLoadsCodexAppServerSkills(t *testing.T) {
	codexDir := t.TempDir()
	projectPath := t.TempDir()
	t.Setenv("CODEX_HOME", codexDir)
	restoreCapabilities := stubCodexAppServerCapabilities(func(ctx context.Context, binaryPath, providerID, projectPath string, force bool) ([]provider.Capability, error) {
		return []provider.Capability{
			{
				Provider:    providerID,
				Name:        "frontend-design",
				SlashName:   "/frontend-design",
				Kind:        string(provider.CapabilityKindSkill),
				Description: "Frontend design skill",
				Scope:       string(provider.CapabilityScopeUser),
			},
			{
				Provider:    providerID,
				Name:        "openai-docs",
				SlashName:   "/openai-docs",
				Kind:        string(provider.CapabilityKindSkill),
				Description: "OpenAI docs skill",
				Scope:       string(provider.CapabilityScopeSystem),
			},
		}, nil
	})
	defer restoreCapabilities()
	restoreBinary := stubCodexBinary("/tmp/codex")
	defer restoreBinary()

	layers, err := (&Driver{}).DiscoverProviderCapabilities(context.Background(), projectPath, false)
	if err != nil {
		t.Fatalf("DiscoverProviderCapabilities failed: %v", err)
	}

	assertCapability(t, layers.AllVisible, "skill", "/frontend-design", "user")
	assertCapability(t, layers.AllVisible, "skill", "/openai-docs", "system")
}

func TestDiscoverProviderCapabilitiesLoadsCodexServiceTierCommands(t *testing.T) {
	codexDir := t.TempDir()
	projectPath := t.TempDir()
	t.Setenv("CODEX_HOME", codexDir)
	restoreCapabilities := stubCodexAppServerCapabilities(func(ctx context.Context, binaryPath, providerID, projectPath string, force bool) ([]provider.Capability, error) {
		return codexModelServiceTierCommandsToCapabilities(providerID, codexModelListResponse{
			Data: []codexModelListEntry{
				{
					ServiceTiers: []codexModelServiceTier{
						{
							ID:          "priority",
							Name:        "fast",
							Description: "1.5x speed, increased usage",
						},
					},
				},
			},
		}), nil
	})
	defer restoreCapabilities()
	restoreBinary := stubCodexBinary("/tmp/codex")
	defer restoreBinary()

	layers, err := (&Driver{}).DiscoverProviderCapabilities(context.Background(), projectPath, false)
	if err != nil {
		t.Fatalf("DiscoverProviderCapabilities failed: %v", err)
	}

	assertCapability(t, layers.AllVisible, "command", "/fast", "system")
}

func TestDiscoverProviderCapabilitiesReturnsCodexAppServerError(t *testing.T) {
	codexDir := t.TempDir()
	t.Setenv("CODEX_HOME", codexDir)
	restoreCapabilities := stubCodexAppServerCapabilities(func(ctx context.Context, binaryPath, providerID, projectPath string, force bool) ([]provider.Capability, error) {
		return nil, os.ErrNotExist
	})
	defer restoreCapabilities()
	restoreBinary := stubCodexBinary("/tmp/codex")
	defer restoreBinary()

	if _, err := (&Driver{}).DiscoverProviderCapabilities(context.Background(), "", false); err == nil {
		t.Fatal("expected app-server discovery error")
	}
}

func TestCodexSkillsToCapabilitiesMapsScopesAndDescriptions(t *testing.T) {
	short := "Short docs"
	defaultPrompt := "Use $ARGUMENTS"
	result := codexSkillsListResponse{
		Data: []codexSkillsListEntry{
			{
				Skills: []codexSkillCapability{
					{
						Name:        "docs",
						Description: "Long docs",
						Path:        "/tmp/docs/SKILL.md",
						Scope:       "repo",
						Enabled:     true,
						Interface: &codexSkillInterface{
							ShortDescription: &short,
							DefaultPrompt:    &defaultPrompt,
						},
						Dependencies: &codexSkillDependency{
							Tools: []codexSkillToolDependency{{Value: "shell"}},
						},
					},
					{
						Name:    "disabled",
						Scope:   "user",
						Enabled: false,
					},
				},
			},
		},
	}

	capabilities := codexSkillsToCapabilities("codex", result)
	if len(capabilities) != 1 {
		t.Fatalf("expected one enabled capability, got %#v", capabilities)
	}
	got := capabilities[0]
	if got.SlashName != "/docs" || got.Scope != "project" || got.Description != "Short docs" || !got.AcceptsArguments {
		t.Fatalf("unexpected capability: %#v", got)
	}
	if got.Content != "Use $ARGUMENTS" {
		t.Fatalf("expected default prompt content, got %q", got.Content)
	}
	if len(got.AllowedTools) != 1 || got.AllowedTools[0] != "shell" {
		t.Fatalf("unexpected tools: %#v", got.AllowedTools)
	}
}

func TestCodexModelServiceTierCommandsToCapabilities(t *testing.T) {
	result := codexModelListResponse{
		Data: []codexModelListEntry{
			{
				ServiceTiers: []codexModelServiceTier{
					{ID: "priority", Name: "fast", Description: "1.5x speed, increased usage"},
					{ID: "batch", Name: "slow", Description: "lower priority"},
				},
				AdditionalSpeedTiers: []string{"fast", "legacy"},
			},
		},
	}

	capabilities := codexModelServiceTierCommandsToCapabilities("codex", result)
	assertCapability(t, capabilities, "command", "/fast", "system")
	assertCapability(t, capabilities, "command", "/slow", "system")
	assertCapability(t, capabilities, "command", "/legacy", "system")
	if len(capabilities) != 3 {
		t.Fatalf("expected deduped service tier capabilities, got %#v", capabilities)
	}
}

func stubCodexAppServerCapabilities(fn func(context.Context, string, string, string, bool) ([]provider.Capability, error)) func() {
	original := queryCodexAppServerCapabilities
	queryCodexAppServerCapabilities = fn
	return func() {
		queryCodexAppServerCapabilities = original
	}
}

func stubCodexBinary(path string) func() {
	original := discoverCodexBinary
	discoverCodexBinary = func(binaryName string, extraCandidates []string) (string, error) {
		return path, nil
	}
	return func() {
		discoverCodexBinary = original
	}
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
