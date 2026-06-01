package claude

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeCapabilityNames(t *testing.T) {
	caps := normalizeCapabilities(
		[]CommandSummary{{Name: "review", Description: "Request code review"}},
		[]string{"loop"},
		nil,
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

func TestBuildCapabilityLayersFromSingleSnapshot(t *testing.T) {
	layers := BuildCapabilityLayersFromSnapshot(CapabilitySnapshot{
		Stage: string(DiscoveryStageProject),
		Commands: []CommandSummary{
			{Name: "review", Description: "Request code review"},
			{Name: "user-cmd", Description: "User command (user)"},
			{Name: "project-cmd", Description: "Project command (project: example)"},
		},
		Skills: []string{"loop"},
		Agents: []string{"general-purpose"},
	})

	assertHasCapability(t, layers.System, string(CapabilityKindCommand), "review")
	assertHasCapability(t, layers.System, string(CapabilityKindSkill), "loop")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindAgent), "general-purpose")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindCommand), "user-cmd")
	assertHasCapability(t, layers.ProjectOnly, string(CapabilityKindCommand), "project-cmd")
}

func TestParseDiscoveryMessages(t *testing.T) {
	lines := [][]byte{
		[]byte(`{"type":"log","message":"ignore me"}`),
		[]byte(`{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":"[files]"},{"name":"review","description":"duplicate should be ignored","argumentHint":""}],"agents":[{"name":"general-purpose"},{"name":"general-purpose"}]}}}`),
		[]byte(`{"type":"system","subtype":"init","skills":["loop","brainstorm","loop"]}`),
	}

	commands, skills, agents, err := CollectDiscoveryData(lines)
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
	wantAgents := []string{"general-purpose"}
	if !reflect.DeepEqual(agents, wantAgents) {
		t.Fatalf("expected agents %#v, got %#v", wantAgents, agents)
	}
}

func TestDiscoverCapabilityLayers(t *testing.T) {
	projectPath := "/tmp/example-project"
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageProject: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "foo", Description: "Foo (user)"}, {Name: "bar", Description: "Bar (project)"}},
				Skills:   []string{"help"},
			},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	layers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected no discovery error, got %v", err)
	}

	assertStageCalls(t, transport.calls, projectPath, 0, 0, 1)

	assertHasCapability(t, layers.System, string(CapabilityKindCommand), "review")
	assertHasCapability(t, layers.System, string(CapabilityKindSkill), "help")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindCommand), "foo")
	assertHasCapability(t, layers.ProjectOnly, string(CapabilityKindCommand), "bar")

	assertCapabilityOrder(t, layers.AllVisible, []string{
		"system:command:review",
		"system:skill:help",
		"user:command:foo",
		"project:command:bar",
	})
}

func TestDiscoverCapabilityLayersReturnsTransportError(t *testing.T) {
	expectedErr := errors.New("project stage failed")
	transport := &stubDiscoveryTransport{
		errByStage: map[DiscoveryStage]error{
			DiscoveryStageProject: expectedErr,
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	_, err := service.Discover("/tmp/example-project")
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
	assertStageCalls(t, transport.calls, "/tmp/example-project", 0, 0, 1)
}

func TestDiscoverCapabilityLayersWithoutProjectUsesUserStage(t *testing.T) {
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageUser: {
				Stage:    "user",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd", Description: "User command (user)"}},
				Skills:   []string{"user-skill"},
			},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	layers, err := service.Discover("")
	if err != nil {
		t.Fatalf("expected no discovery error, got %v", err)
	}

	assertStageCalls(t, transport.calls, "", 0, 1, 0)
	assertHasCapability(t, layers.System, string(CapabilityKindCommand), "review")
	assertHasCapability(t, layers.System, string(CapabilityKindSkill), "user-skill")
	assertHasCapability(t, layers.UserOnly, string(CapabilityKindCommand), "user-cmd")
	if len(layers.ProjectOnly) != 0 {
		t.Fatalf("expected no project capabilities, got %#v", layers.ProjectOnly)
	}
}

func TestDiscoverCapabilityLayersReturnsProjectStageError(t *testing.T) {
	expectedErr := errors.New("project discovery failed")
	transport := &stubDiscoveryTransport{
		errByStage: map[DiscoveryStage]error{
			DiscoveryStageProject: expectedErr,
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	_, err := service.Discover("/tmp/example-project")
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected project discovery error %v, got %v", expectedErr, err)
	}
	assertStageCalls(t, transport.calls, "/tmp/example-project", 0, 0, 1)
}

func TestParseDiscoveryMessagesIgnoresNonJSONLines(t *testing.T) {
	lines := [][]byte{
		[]byte("plain text from stdout"),
		[]byte(`{"type":"system","subtype":"init","skills":["loop"]}`),
	}

	commands, skills, agents, err := CollectDiscoveryData(lines)
	if err != nil {
		t.Fatalf("expected non-JSON lines to be ignored, got %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("expected no commands, got %#v", commands)
	}
	if !reflect.DeepEqual(skills, []string{"loop"}) {
		t.Fatalf("expected skills %#v, got %#v", []string{"loop"}, skills)
	}
	if len(agents) != 0 {
		t.Fatalf("expected no agents, got %#v", agents)
	}
}

func TestCapabilityDiscoveryCache(t *testing.T) {
	projectA := "/tmp/project-a"
	projectB := "/tmp/project-b"
	transport := &stubDiscoveryTransport{
		projectSnapshots: map[string]CapabilitySnapshot{
			projectA: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd", Description: "User command (user)"}, {Name: "project-a-cmd", Description: "Project A (project)"}},
				Skills:   []string{"help"},
			},
			projectB: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd", Description: "User command (user)"}, {Name: "project-b-cmd", Description: "Project B (project)"}},
				Skills:   []string{"help"},
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
	assertStageCalls(t, transport.calls, projectA, 0, 0, 1)

	layersForOtherProject, err := service.Discover(projectB)
	if err != nil {
		t.Fatalf("expected discover for second project to succeed, got %v", err)
	}
	assertHasCapability(t, layersForOtherProject.ProjectOnly, string(CapabilityKindCommand), "project-b-cmd")
	assertStageCalls(t, transport.calls, projectA, 0, 0, 1)
	assertStageCalls(t, transport.calls, projectB, 0, 0, 1)

	generation = "gen-2"
	service.cachedVersion = ""
	service.cachedVersionErr = nil
	thirdLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected discover after generation change to succeed, got %v", err)
	}
	assertHasCapability(t, thirdLayers.ProjectOnly, string(CapabilityKindCommand), "project-a-cmd")
	assertStageCalls(t, transport.calls, projectA, 0, 0, 2)

	version = "2.0.0"
	service.cachedVersion = ""
	service.cachedVersionErr = nil
	fourthLayers, err := service.Discover(projectA)
	if err != nil {
		t.Fatalf("expected discover after version change to succeed, got %v", err)
	}
	assertHasCapability(t, fourthLayers.ProjectOnly, string(CapabilityKindCommand), "project-a-cmd")
	assertStageCalls(t, transport.calls, projectA, 0, 0, 3)

	_, err = service.Refresh(projectA)
	if err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	assertStageCalls(t, transport.calls, projectA, 0, 0, 4)
}

func TestRefreshCapabilityLayers(t *testing.T) {
	projectPath := "/tmp/project-refresh"
	transport := &stubDiscoveryTransport{
		projectSnapshots: map[string]CapabilitySnapshot{
			projectPath: {
				Stage:    "project",
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-old", Description: "Old user command (user)"}, {Name: "project-old", Description: "Old project command (project)"}},
				Skills:   []string{"help"},
			},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	service.claudeVersion = func() (string, error) { return "1.0.0", nil }
	service.userCacheGeneration = func() (string, error) { return "gen-1", nil }

	initialLayers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected initial discover to succeed, got %v", err)
	}
	assertHasCapability(t, initialLayers.UserOnly, string(CapabilityKindCommand), "user-old")
	assertHasCapability(t, initialLayers.ProjectOnly, string(CapabilityKindCommand), "project-old")
	assertStageCalls(t, transport.calls, projectPath, 0, 0, 1)

	transport.projectSnapshots[projectPath] = CapabilitySnapshot{
		Stage:    "project",
		Commands: []CommandSummary{{Name: "review"}, {Name: "user-new", Description: "New user command (user)"}, {Name: "project-new", Description: "New project command (project)"}},
		Skills:   []string{"help"},
	}

	cachedLayers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected cached discover to succeed, got %v", err)
	}
	assertHasCapability(t, cachedLayers.UserOnly, string(CapabilityKindCommand), "user-old")
	assertHasCapability(t, cachedLayers.ProjectOnly, string(CapabilityKindCommand), "project-old")
	assertStageCalls(t, transport.calls, projectPath, 0, 0, 1)

	refreshedLayers, err := service.Refresh(projectPath)
	if err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	assertHasCapability(t, refreshedLayers.UserOnly, string(CapabilityKindCommand), "user-new")
	assertHasCapability(t, refreshedLayers.ProjectOnly, string(CapabilityKindCommand), "project-new")
	assertMissingCapability(t, refreshedLayers.UserOnly, string(CapabilityKindCommand), "user-old")
	assertMissingCapability(t, refreshedLayers.ProjectOnly, string(CapabilityKindCommand), "project-old")
	assertStageCalls(t, transport.calls, projectPath, 0, 0, 2)

	updatedCachedLayers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected discover after refresh to succeed, got %v", err)
	}
	assertHasCapability(t, updatedCachedLayers.UserOnly, string(CapabilityKindCommand), "user-new")
	assertHasCapability(t, updatedCachedLayers.ProjectOnly, string(CapabilityKindCommand), "project-new")
	assertMissingCapability(t, updatedCachedLayers.UserOnly, string(CapabilityKindCommand), "user-old")
	assertMissingCapability(t, updatedCachedLayers.ProjectOnly, string(CapabilityKindCommand), "project-old")
	assertStageCalls(t, transport.calls, projectPath, 0, 0, 2)
}

func TestBuildDiscoveryCommand(t *testing.T) {
	realHome := t.TempDir()
	projectPath := t.TempDir()
	userCwd := t.TempDir()

	transport := &ClaudeCapabilityDiscoveryTransport{
		binaryPath:    "/usr/local/bin/claude",
		realHomeDir:   realHome,
		discoveryArgs: []string{"--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"},
		makeTempDir: func(dir, pattern string) (string, error) {
			return t.TempDir(), nil
		},
	}

	tests := []struct {
		name     string
		stage    DiscoveryStage
		wantHome string
		wantDir  string
	}{
		{
			name:     "user stage uses real home and isolated cwd",
			stage:    DiscoveryStageUser,
			wantHome: realHome,
			wantDir:  userCwd,
		},
		{
			name:     "project stage uses real home and project cwd",
			stage:    DiscoveryStageProject,
			wantHome: realHome,
			wantDir:  projectPath,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			transport.makeTempDir = func(dir, pattern string) (string, error) {
				calls++
				switch tt.stage {
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
			if env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] != "true" {
				t.Fatalf("expected nonessential traffic to be disabled, got %q", env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"])
			}

			addDirs := addDirArgs(cmd.Args[1:])
			if len(addDirs) != 0 {
				t.Fatalf("expected no --add-dir args, got %#v", addDirs)
			}
		})
	}
}

func TestCachedCapabilityLayers(t *testing.T) {
	projectPath := "/tmp/project-cache-read"
	transport := &stubDiscoveryTransport{
		projectSnapshots: map[string]CapabilitySnapshot{
			projectPath: {Stage: "project", Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd", Description: "User command (user)"}, {Name: "project-cmd", Description: "Project command (project)"}}, Skills: []string{"help"}},
		},
	}

	service := NewCapabilityDiscoveryService(transport)
	service.claudeVersion = func() (string, error) { return "1.0.0", nil }
	service.userCacheGeneration = func() (string, error) { return "gen-1", nil }

	if _, ok := service.Cached(projectPath); ok {
		t.Fatal("expected cache miss before discover")
	}
	layers, err := service.Discover(projectPath)
	if err != nil {
		t.Fatalf("expected discover to succeed, got %v", err)
	}
	cached, ok := service.Cached(projectPath)
	if !ok {
		t.Fatal("expected cached layers after discover")
	}
	if !reflect.DeepEqual(layers, cached) {
		t.Fatalf("expected cached layers to match discover result, got %#v and %#v", layers, cached)
	}
}

func TestCachedCapabilityLayersRequiresSameProjectKey(t *testing.T) {
	projectPath := "/tmp/project-cache-partial"
	transport := &stubDiscoveryTransport{
		snapshots: map[DiscoveryStage]CapabilitySnapshot{
			DiscoveryStageUser: {
				Stage:    string(DiscoveryStageUser),
				Commands: []CommandSummary{{Name: "review"}, {Name: "user-cmd", Description: "User command (user)"}},
				Skills:   []string{"loop"},
			},
		},
		projectSnapshots: map[string]CapabilitySnapshot{},
	}

	service := NewCapabilityDiscoveryService(transport)
	service.claudeVersion = func() (string, error) { return "1.0.0", nil }
	service.userCacheGeneration = func() (string, error) { return "gen-1", nil }

	if ok := service.PrewarmUser(); !ok {
		t.Fatal("expected user prewarm to succeed")
	}

	if _, ok := service.Cached(projectPath); ok {
		t.Fatal("expected user prewarm cache not to satisfy project-specific cache")
	}
	cached, ok := service.Cached("")
	if !ok {
		t.Fatal("expected cached layers for empty project path")
	}
	assertHasCapability(t, cached.AllVisible, string(CapabilityKindCommand), "review")
	assertHasCapability(t, cached.AllVisible, string(CapabilityKindSkill), "loop")
	assertStageCalls(t, transport.calls, "", 0, 1, 0)
}

func TestDiscoveryTransportAllowsCommandsWithoutSkills(t *testing.T) {
	binPath, discoveryArgs := writeFakeClaudeDiscovery(t, []fakeDiscoveryStep{
		{Line: `{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":"[files]"}]}}}`},
	})

	transport := &ClaudeCapabilityDiscoveryTransport{
		binaryPath:    binPath,
		realHomeDir:   t.TempDir(),
		discoveryArgs: discoveryArgs,
		timeout:       2 * time.Second,
		makeTempDir:   os.MkdirTemp,
	}
	snapshot, err := transport.Run(DiscoveryStageUser, "")
	if err != nil {
		t.Fatalf("expected commands-only discovery to succeed, got %v", err)
	}
	if len(snapshot.Commands) != 1 || snapshot.Commands[0].Name != "review" {
		t.Fatalf("expected review command, got %#v", snapshot.Commands)
	}
	if len(snapshot.Skills) != 0 {
		t.Fatalf("expected no skills, got %#v", snapshot.Skills)
	}
}
func TestDiscoveryTransportReturnsPartialCapabilitiesBeforeLateSkills(t *testing.T) {
	binPath, discoveryArgs := writeFakeClaudeDiscovery(t, []fakeDiscoveryStep{
		{Line: `{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":"[files]"}]}}}`},
		{Sleep: 200 * time.Millisecond},
		{Line: `{"type":"system","subtype":"init","skills":["loop"]}`},
	})

	transport := &ClaudeCapabilityDiscoveryTransport{
		binaryPath:    binPath,
		realHomeDir:   t.TempDir(),
		discoveryArgs: discoveryArgs,
		timeout:       2 * time.Second,
		makeTempDir:   os.MkdirTemp,
	}
	snapshot, err := transport.Run(DiscoveryStageUser, "")
	if err != nil {
		t.Fatalf("expected partial discovery to succeed, got %v", err)
	}
	if len(snapshot.Commands) != 1 || snapshot.Commands[0].Name != "review" {
		t.Fatalf("expected review command, got %#v", snapshot.Commands)
	}
}

func TestDiscoveryTransportReturnsAfterCommandsAndSkillsWithoutWaitingForProcessExit(t *testing.T) {
	binPath, discoveryArgs := writeFakeClaudeDiscovery(t, []fakeDiscoveryStep{
		{Line: `{"type":"control_response","response":{"subtype":"success","response":{"commands":[{"name":"review","description":"Request code review","argumentHint":"[files]"}]}}}`},
		{Line: `{"type":"system","subtype":"init","skills":["loop"]}`},
		{Sleep: 10 * time.Second},
	})

	transport := &ClaudeCapabilityDiscoveryTransport{
		binaryPath:    binPath,
		realHomeDir:   t.TempDir(),
		discoveryArgs: discoveryArgs,
		timeout:       4 * time.Second,
		makeTempDir:   os.MkdirTemp,
	}
	snapshot, err := transport.Run(DiscoveryStageUser, "")
	if err != nil {
		t.Fatalf("expected discovery to finish without waiting for process exit, got %v", err)
	}
	if len(snapshot.Commands) != 1 || snapshot.Commands[0].Name != "review" {
		t.Fatalf("expected review command, got %#v", snapshot.Commands)
	}
	if !reflect.DeepEqual(snapshot.Skills, []string{"loop"}) {
		t.Fatalf("expected skills %#v, got %#v", []string{"loop"}, snapshot.Skills)
	}
}

type fakeDiscoveryStep struct {
	Line  string
	Sleep time.Duration
}

func writeFakeClaudeDiscovery(t *testing.T, steps []fakeDiscoveryStep) (string, []string) {
	t.Helper()

	tmpDir := t.TempDir()
	stepsPath := filepath.Join(tmpDir, "fake-claude-discovery.steps")
	lines := make([]string, 0, len(steps))
	for _, step := range steps {
		if step.Sleep > 0 {
			lines = append(lines, "sleep "+step.Sleep.String())
		}
		if step.Line != "" {
			lines = append(lines, "line "+step.Line)
		}
	}
	if err := os.WriteFile(stepsPath, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	return os.Args[0], []string{"-test.run=TestFakeClaudeDiscoveryHelperProcess", "--", "fake-discovery", stepsPath}
}

func TestFakeClaudeDiscoveryHelperProcess(t *testing.T) {
	args := os.Args
	separator := -1
	for i, arg := range args {
		if arg == "--" {
			separator = i
			break
		}
	}
	if separator < 0 || separator+1 >= len(args) || args[separator+1] != "fake-discovery" {
		return
	}

	if separator+2 >= len(args) {
		os.Exit(2)
	}

	_, _ = fmt.Fscanln(os.Stdin)
	data, err := os.ReadFile(args[separator+2])
	if err != nil {
		os.Exit(2)
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if value, ok := strings.CutPrefix(line, "sleep "); ok {
			duration, err := time.ParseDuration(value)
			if err != nil {
				os.Exit(2)
			}
			time.Sleep(duration)
			continue
		}
		if value, ok := strings.CutPrefix(line, "line "); ok {
			fmt.Println(value)
		}
	}
	os.Exit(0)
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

func assertMissingCapability(t *testing.T, caps []ClaudeCapability, kind, name string) {
	t.Helper()

	for _, cap := range caps {
		if cap.Kind == kind && cap.Name == name {
			t.Fatalf("did not expect capability %s:%s in %+v", kind, name, caps)
		}
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
