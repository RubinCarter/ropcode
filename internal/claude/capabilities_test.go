package claude

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
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

func TestDiscoverCapabilityLayers(t *testing.T) {
	projectPath := "/tmp/example-project"
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageSystem: {
				Stage:    "system",
				Commands: []CommandSummary{{Name: "review"}},
				Skills:   []string{"help"},
			},
			DiscoveryStageUser: {
				Stage:    "user",
				Commands: []CommandSummary{{Name: "review"}, {Name: "foo"}},
				Skills:   []string{"help", "loop"},
			},
			DiscoveryStageProject: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "foo"}, {Name: "bar"}},
				Skills:   []string{"help", "loop", "proj"},
			},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	layers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected no discovery error, got %v", err)
	}

	if !reflect.DeepEqual(transport.calls, []discoveryCall{
		{stage: DiscoveryStageSystem, projectPath: projectPath},
		{stage: DiscoveryStageUser, projectPath: projectPath},
		{stage: DiscoveryStageProject, projectPath: projectPath},
	}) {
		t.Fatalf("expected staged discovery order, got %#v", transport.calls)
	}

	assertHasCapability(t, layers.System, string(CapabilityKindCommand), "review")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindCommand), "foo")
	assertHasCapability(t, layers.ProjectOnly, string(CapabilityKindSkill), "proj")

	assertCapabilityOrder(t, layers.AllVisible, []string{
		"system:command:review",
		"system:skill:help",
		"user:command:foo",
		"user:skill:loop",
		"project:command:bar",
		"project:skill:proj",
	})
}

func TestDiscoverCapabilityLayersReturnsTransportError(t *testing.T) {
	expectedErr := errors.New("user stage failed")
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageSystem: {
				Stage:    "system",
				Commands: []CommandSummary{{Name: "review"}},
				Skills:   []string{"help"},
			},
		},
		errByStage: map[DiscoveryStage]error{
			DiscoveryStageUser: expectedErr,
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	_, err := service.Discover("/tmp/example-project")
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
	if len(transport.calls) != 2 {
		t.Fatalf("expected discovery to stop after failing user stage, got %d calls", len(transport.calls))
	}
}

func TestParseDiscoveryMessagesIgnoresNonJSONLines(t *testing.T) {
	lines := [][]byte{
		[]byte("plain text from stdout"),
		[]byte(`{"type":"system","subtype":"init","skills":["loop"]}`),
	}

	commands, skills, err := CollectDiscoveryData(lines)
	if err != nil {
		t.Fatalf("expected non-JSON lines to be ignored, got %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("expected no commands, got %#v", commands)
	}
	if !reflect.DeepEqual(skills, []string{"loop"}) {
		t.Fatalf("expected skills %#v, got %#v", []string{"loop"}, skills)
	}
}

func TestCapabilityDiscoveryCache(t *testing.T) {
	projectA := "/tmp/project-a"
	projectB := "/tmp/project-b"
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageSystem: {
				Stage:    "system",
				Commands: []CommandSummary{{Name: "review"}},
				Skills:   []string{"help"},
			},
			DiscoveryStageUser: {
				Stage:    "user",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd"}},
				Skills:   []string{"help", "user-skill"},
			},
		},
		projectSnapshots: map[string]CapabilitySnapshot{
			projectA: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd"}, {Name: "project-a-cmd"}},
				Skills:   []string{"help", "user-skill", "project-a-skill"},
			},
			projectB: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd"}, {Name: "project-b-cmd"}},
				Skills:   []string{"help", "user-skill", "project-b-skill"},
			},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	version := "1.0.0"
	generation := "gen-1"
	service.claudeVersion = func() (string, error) { return version, nil }
	service.userCacheGeneration = func() (string, error) { return generation, nil }

	firstLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected first discover to succeed, got %v", err)
	}
	secondLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected second discover to succeed, got %v", err)
	}
	if !reflect.DeepEqual(firstLayers, secondLayers) {
		t.Fatalf("expected cached project layers to match, got %#v and %#v", firstLayers, secondLayers)
	}
	assertStageCalls(t, transport.calls, projectA, 1, 1, 1)

	layersForOtherProject, err := service.Discover(projectB)
	if err != nil {
		t.Fatalf("expected discover for second project to succeed, got %v", err)
	}
	assertHasCapability(t, layersForOtherProject.ProjectOnly, string(CapabilityKindCommand), "project-b-cmd")
	assertStageCalls(t, transport.calls, projectA, 1, 1, 1)
	assertStageCalls(t, transport.calls, projectB, 0, 0, 1)

	generation = "gen-2"
	thirdLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected discover after generation change to succeed, got %v", err)
	}
	assertHasCapability(t, thirdLayers.ProjectOnly, string(CapabilityKindCommand), "project-a-cmd")
	assertStageCalls(t, transport.calls, projectA, 1, 2, 2)

	version = "2.0.0"
	fourthLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected discover after version change to succeed, got %v", err)
	}
	assertHasCapability(t, fourthLayers.ProjectOnly, string(CapabilityKindSkill), "project-a-skill")
	assertStageCalls(t, transport.calls, projectA, 2, 3, 3)

	_, err = service.Refresh(projectA)
	if err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	assertStageCalls(t, transport.calls, projectA, 3, 4, 4)
}

func TestBuildDiscoveryCommand(t *testing.T) {
	realHome := t.TempDir()
	projectPath := t.TempDir()
	systemCwd := t.TempDir()
	userCwd := t.TempDir()

	transport := &ClaudeCapabilityDiscoveryTransport{
		binaryPath:    "/usr/local/bin/claude",
		realHomeDir:   realHome,
		discoveryArgs: []string{"--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"},
		makeTempDir: func(dir, pattern string) (string, error) {
			return t.TempDir(), nil
		},
	}

	tests := []struct {
		name         string
		stage        DiscoveryStage
		wantHome     string
		wantDir      string
		wantIsolated bool
		wantBaseEnv  bool
	}{
		{
			name:         "system stage isolates home and cwd",
			stage:        DiscoveryStageSystem,
			wantDir:      systemCwd,
			wantIsolated: true,
			wantBaseEnv:  true,
		},
		{
			name:         "user stage uses real home and isolated cwd",
			stage:        DiscoveryStageUser,
			wantHome:     realHome,
			wantDir:      userCwd,
			wantIsolated: false,
			wantBaseEnv:  false,
		},
		{
			name:         "project stage uses real home and project cwd",
			stage:        DiscoveryStageProject,
			wantHome:     realHome,
			wantDir:      projectPath,
			wantIsolated: false,
			wantBaseEnv:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			transport.makeTempDir = func(dir, pattern string) (string, error) {
				calls++
				switch tt.stage {
				case DiscoveryStageSystem:
					if calls == 1 {
						return t.TempDir(), nil
					}
					return systemCwd, nil
				case DiscoveryStageUser:
					return userCwd, nil
				default:
					return t.TempDir(), nil
				}
			}

			cmd, cleanup, err := transport.buildCommand(context.Background(), tt.stage, projectPath)
			if err != nil {
				t.Fatalf("expected command build to succeed, got %v", err)
			}
			defer cleanup()

			if cmd.Path != transport.binaryPath {
				t.Fatalf("expected binary path %q, got %q", transport.binaryPath, cmd.Path)
			}
			if cmd.Dir != tt.wantDir {
				t.Fatalf("expected working directory %q, got %q", tt.wantDir, cmd.Dir)
			}
			if !reflect.DeepEqual(cmd.Args[1:], transport.discoveryArgs) {
				t.Fatalf("expected discovery args %#v, got %#v", transport.discoveryArgs, cmd.Args[1:])
			}

			env := envMap(cmd.Env)
			if env["HOME"] == "" {
				t.Fatal("expected HOME to be set")
			}
			if tt.wantHome != "" && env["HOME"] != tt.wantHome {
				t.Fatalf("expected HOME %q, got %q", tt.wantHome, env["HOME"])
			}
			if tt.wantIsolated && env["HOME"] == realHome {
				t.Fatalf("expected isolated HOME, got real HOME %q", env["HOME"])
			}
			if env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] != "true" {
				t.Fatalf("expected nonessential traffic to be disabled, got %q", env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"])
			}

			addDirs := addDirArgs(cmd.Args[1:])
			if len(addDirs) != 0 {
				t.Fatalf("expected no --add-dir args, got %#v", addDirs)
			}

			if tt.wantBaseEnv {
				for _, key := range []string{"TMPDIR", "TMP"} {
					if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" && env[key] != value {
						t.Fatalf("expected %s to be preserved in base env, got %q want %q", key, env[key], value)
					}
				}
				if strings.TrimSpace(env["PATH"]) == "" {
					t.Fatal("expected PATH to be set in base env")
				}
			}
		})
	}
}

type discoveryCall struct {
	stage       DiscoveryStage
	projectPath string
}

type stubDiscoveryTransport struct {
	snapshots        map[DiscoveryStage]CapabilitySnapshot
	projectSnapshots map[string]CapabilitySnapshot
	errByStage       map[DiscoveryStage]error
	calls            []discoveryCall
}

func (s *stubDiscoveryTransport) Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error) {
	s.calls = append(s.calls, discoveryCall{stage: stage, projectPath: projectPath})
	if err := s.errByStage[stage]; err != nil {
		return CapabilitySnapshot{}, err
	}
	if stage == DiscoveryStageProject {
		if snapshot, ok := s.projectSnapshots[projectPath]; ok {
			return snapshot, nil
		}
	}
	snapshot, ok := s.snapshots[stage]
	if !ok {
		return CapabilitySnapshot{}, nil
	}
	return snapshot, nil
}

func envMap(env []string) map[string]string {
	result := make(map[string]string, len(env))
	for _, entry := range env {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		result[parts[0]] = parts[1]
	}
	return result
}

func addDirArgs(args []string) []string {
	result := make([]string, 0)
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--add-dir" {
			result = append(result, args[i+1])
			i++
		}
	}
	return result
}

func assertStageCalls(t *testing.T, calls []discoveryCall, projectPath string, wantSystem, wantUser, wantProject int) {
	t.Helper()

	gotSystem := 0
	gotUser := 0
	gotProject := 0
	for _, call := range calls {
		if call.projectPath != projectPath {
			continue
		}
		switch call.stage {
		case DiscoveryStageSystem:
			gotSystem++
		case DiscoveryStageUser:
			gotUser++
		case DiscoveryStageProject:
			gotProject++
		}
	}

	if gotSystem != wantSystem || gotUser != wantUser || gotProject != wantProject {
		t.Fatalf("expected calls for %q to be system=%d user=%d project=%d, got system=%d user=%d project=%d", projectPath, wantSystem, wantUser, wantProject, gotSystem, gotUser, gotProject)
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
