package claude

import (
	"reflect"
	"testing"
)

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
		System:      []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review"}},
		UserOnly:    []ClaudeCapability{{Kind: string(CapabilityKindSkill), Name: "loop", SlashName: "/loop"}},
		ProjectOnly: []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "deploy", SlashName: "/deploy"}},
		AllVisible:  []ClaudeCapability{{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review"}},
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

func TestCapabilityKeyNormalizesNames(t *testing.T) {
	key := capabilityKey(string(CapabilityKindCommand), "/review")
	if key != "command:review" {
		t.Fatalf("expected normalized capability key, got %q", key)
	}
}

func TestDedupeCapabilitiesFiltersDuplicatesAndEmptyNames(t *testing.T) {
	caps := dedupeCapabilities([]ClaudeCapability{
		{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review", Key: capabilityKey(string(CapabilityKindCommand), "review")},
		{Kind: string(CapabilityKindCommand), Name: "review", SlashName: "/review", Key: capabilityKey(string(CapabilityKindCommand), "/review")},
		{Kind: string(CapabilityKindSkill), SlashName: "/loop"},
		{Kind: string(CapabilityKindSkill), Name: "   ", SlashName: ""},
	})

	if len(caps) != 2 {
		t.Fatalf("expected 2 capabilities after dedupe/filter, got %d", len(caps))
	}
	if caps[1].Name != "loop" {
		t.Fatalf("expected slash name backfill to produce loop, got %q", caps[1].Name)
	}
	if caps[1].Key != "skill:loop" {
		t.Fatalf("expected generated key skill:loop, got %q", caps[1].Key)
	}
}

func TestBuildCapabilityLayers(t *testing.T) {
	systemSnap := CapabilitySnapshot{
		Stage:    "system",
		Commands: []CommandSummary{{Name: "review"}},
		Skills:   []string{"help"},
	}
	userSnap := CapabilitySnapshot{
		Stage:    "user",
		Commands: []CommandSummary{{Name: "review"}, {Name: "foo"}},
		Skills:   []string{"help", "loop"},
	}
	projectSnap := CapabilitySnapshot{
		Stage:    "project",
		Commands: []CommandSummary{{Name: "review"}, {Name: "foo"}, {Name: "bar"}},
		Skills:   []string{"help", "loop", "proj"},
	}

	layers := BuildCapabilityLayers(systemSnap, userSnap, projectSnap)

	assertHasCapability(t, layers.UserOnly, string(CapabilityKindCommand), "foo")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindSkill), "loop")
	assertHasCapability(t, layers.ProjectOnly, string(CapabilityKindCommand), "bar")
	assertHasCapability(t, layers.ProjectOnly, string(CapabilityKindSkill), "proj")

	if len(layers.AllVisible) != 6 {
		t.Fatalf("expected 6 all-visible capabilities, got %d", len(layers.AllVisible))
	}

	assertCapabilityOrder(t, layers.AllVisible, []string{
		"system:command:review",
		"system:skill:help",
		"user:command:foo",
		"user:skill:loop",
		"project:command:bar",
		"project:skill:proj",
	})
}

func TestParseDiscoveryMessages(t *testing.T) {
	lines := [][]byte{
		[]byte(`{"type":"log","message":"ignore me"}`),
		[]byte(`{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":"[files]"},{"name":"review","description":"duplicate should be ignored","argumentHint":""}]}}}`),
		[]byte(`{"type":"system","subtype":"init","skills":["loop","brainstorm","loop"]}`),
	}

	commands, skills, err := CollectDiscoveryData(lines)
	if err != nil {
		t.Fatalf("expected no error collecting discovery data, got %v", err)
	}

	wantCommands := []CommandSummary{{
		Name:         "review",
		Description:  "Request code review",
		ArgumentHint: "[files]",
	}}
	if !reflect.DeepEqual(commands, wantCommands) {
		t.Fatalf("expected commands %#v, got %#v", wantCommands, commands)
	}

	wantSkills := []string{"loop", "brainstorm"}
	if !reflect.DeepEqual(skills, wantSkills) {
		t.Fatalf("expected skills %#v, got %#v", wantSkills, skills)
	}
}

func assertHasCapability(t *testing.T, caps []ClaudeCapability, kind, name string) {
	t.Helper()

	for _, cap := range caps {
		if cap.Kind == kind && cap.Name == name {
			return
		}
	}

	t.Fatalf("expected capability %s:%s in %+v", kind, name, caps)
}

func assertCapabilityOrder(t *testing.T, caps []ClaudeCapability, want []string) {
	t.Helper()

	if len(caps) != len(want) {
		t.Fatalf("expected %d capabilities, got %d", len(want), len(caps))
	}

	for i, cap := range caps {
		got := cap.Scope + ":" + cap.Kind + ":" + cap.Name
		if got != want[i] {
			t.Fatalf("expected capability at index %d to be %q, got %q", i, want[i], got)
		}
	}
}
