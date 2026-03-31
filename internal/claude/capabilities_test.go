package claude

import "testing"

func TestNormalizeCapabilityNames(t *testing.T) {
	caps := normalizeCapabilities(
		[]CommandSummary{{Name: "review", Description: "Request code review"}},
		[]string{"loop"},
		CapabilityScopeSystem,
	)

	if len(caps) != 2 {
		t.Fatalf("expected 2 capabilities, got %d", len(caps))
	}

	command := caps[0]
	if command.Kind != string(CapabilityKindCommand) {
		t.Fatalf("expected first capability kind %q, got %q", CapabilityKindCommand, command.Kind)
	}
	if command.Name != "review" {
		t.Fatalf("expected first capability name review, got %q", command.Name)
	}
	if command.SlashName != "/review" {
		t.Fatalf("expected first slash name /review, got %q", command.SlashName)
	}
	if command.Scope != string(CapabilityScopeSystem) {
		t.Fatalf("expected first capability scope %q, got %q", CapabilityScopeSystem, command.Scope)
	}

	skill := caps[1]
	if skill.Kind != string(CapabilityKindSkill) {
		t.Fatalf("expected second capability kind %q, got %q", CapabilityKindSkill, skill.Kind)
	}
	if skill.Name != "loop" {
		t.Fatalf("expected second capability name loop, got %q", skill.Name)
	}
	if skill.SlashName != "/loop" {
		t.Fatalf("expected second slash name /loop, got %q", skill.SlashName)
	}
	if skill.Scope != string(CapabilityScopeSystem) {
		t.Fatalf("expected second capability scope %q, got %q", CapabilityScopeSystem, skill.Scope)
	}
}

func TestCapabilityModelShapes(t *testing.T) {
	snapshot := CapabilitySnapshot{
		Stage: "system",
		Commands: []CommandSummary{{
			Name:         "review",
			Description:  "Request code review",
			ArgumentHint: "[files]",
		}},
		Skills: []string{"loop"},
	}

	if len(snapshot.Commands) != 1 {
		t.Fatalf("expected 1 command, got %d", len(snapshot.Commands))
	}
	if len(snapshot.Skills) != 1 {
		t.Fatalf("expected 1 skill, got %d", len(snapshot.Skills))
	}

	layers := CapabilityLayers{
		System: []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review"}},
		UserOnly: []ClaudeCapability{{Kind: string(CapabilityKindSkill), Name: "loop", SlashName: "/loop"}},
		ProjectOnly: []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "deploy", SlashName: "/deploy"}},
		AllVisible: []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review"}},
	}

	if len(layers.System) != 1 {
		t.Fatalf("expected 1 system capability, got %d", len(layers.System))
	}
	if len(layers.UserOnly) != 1 {
		t.Fatalf("expected 1 user-only capability, got %d", len(layers.UserOnly))
	}
	if len(layers.ProjectOnly) != 1 {
		t.Fatalf("expected 1 project-only capability, got %d", len(layers.ProjectOnly))
	}
	if len(layers.AllVisible) != 1 {
		t.Fatalf("expected 1 all-visible capability, got %d", len(layers.AllVisible))
	}
}
