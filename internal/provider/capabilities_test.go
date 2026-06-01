package provider

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

type capabilityEditorDriver struct {
	ProviderDriver
	id      string
	saved   Capability
	deleted Capability
}

func (d *capabilityEditorDriver) ID() string { return d.id }

func (d *capabilityEditorDriver) SaveProviderCapability(ctx context.Context, capability Capability, projectPath string) error {
	d.saved = capability
	return nil
}

func (d *capabilityEditorDriver) DeleteProviderCapability(ctx context.Context, capability Capability, projectPath string) error {
	d.deleted = capability
	return nil
}

func TestManagerSavesProviderCapabilityThroughDriver(t *testing.T) {
	driver := &capabilityEditorDriver{id: "test"}
	manager := NewManager(context.Background(), nil, nil)
	if err := manager.RegisterDriver(driver); err != nil {
		t.Fatalf("RegisterDriver failed: %v", err)
	}

	err := manager.SaveProviderCapability("test", Capability{
		Name:    "review",
		Kind:    string(CapabilityKindCommand),
		Scope:   string(CapabilityScopeUser),
		Content: "body",
	}, "")
	if err != nil {
		t.Fatalf("SaveProviderCapability failed: %v", err)
	}
	if driver.saved.Provider != "test" || driver.saved.Name != "review" || driver.saved.Content != "body" {
		t.Fatalf("unexpected saved capability: %#v", driver.saved)
	}
}

func TestSaveMarkdownCapabilityWritesFile(t *testing.T) {
	dir := t.TempDir()
	err := SaveMarkdownCapability(dir, Capability{
		Name:    "review",
		Kind:    string(CapabilityKindCommand),
		Scope:   string(CapabilityScopeUser),
		Content: "body",
	})
	if err != nil {
		t.Fatalf("SaveMarkdownCapability failed: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(dir, "review.md"))
	if err != nil {
		t.Fatalf("expected file: %v", err)
	}
	if string(content) != "body" {
		t.Fatalf("unexpected content: %q", string(content))
	}
}

func TestLoadSkillCapabilitiesUsesSkillManifestOnly(t *testing.T) {
	dir := t.TempDir()
	skillDir := filepath.Join(dir, "video-skill")
	rulesDir := filepath.Join(skillDir, "rules")
	if err := os.MkdirAll(rulesDir, 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(`---
name: video
description: Video workflows
---

## When to use

Use for video tasks.
`), 0644); err != nil {
		t.Fatalf("write SKILL.md failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(rulesDir, "frames.md"), []byte("frame rules"), 0644); err != nil {
		t.Fatalf("write rules failed: %v", err)
	}

	got, err := LoadSkillCapabilities(SkillCapabilityOptions{
		Provider: "codex",
		Scope:    CapabilityScopeUser,
		BaseDir:  dir,
	})
	if err != nil {
		t.Fatalf("LoadSkillCapabilities failed: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected one skill, got %d: %#v", len(got), got)
	}
	if got[0].Name != "video" || got[0].SlashName != "/video" || got[0].Kind != string(CapabilityKindSkill) {
		t.Fatalf("unexpected skill capability: %#v", got[0])
	}
	if got[0].Description != "Video workflows" {
		t.Fatalf("unexpected description: %q", got[0].Description)
	}
}
