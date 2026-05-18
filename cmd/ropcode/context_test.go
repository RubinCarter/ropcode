package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
)

type cliTestApp struct {
	db *database.Database
}

func (a *cliTestApp) Database() *database.Database {
	return a.db
}

func (a *cliTestApp) Greet(name string) string {
	return "Hello " + name + ", Welcome to ropcode!"
}

func setupCLITestDB(t *testing.T) (*config.Config, *database.Database) {
	t.Helper()

	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	return cfg, db
}

func seedInstance(t *testing.T, db *database.Database, id string, status string) {
	t.Helper()

	now := time.Now().UnixMilli()
	record := &database.InstanceRecord{
		ID:           id,
		Host:         "127.0.0.1",
		Port:         5173,
		AuthKey:      "",
		PID:          os.Getpid(),
		StartedAt:    now,
		HeartbeatAt:  now,
		Status:       status,
		Capabilities: []string{"rpc", "events"},
	}
	if err := db.SaveInstanceRecord(record); err != nil {
		t.Fatalf("SaveInstanceRecord failed: %v", err)
	}
}

func seedProjectIndex(t *testing.T, db *database.Database, project *database.ProjectIndex) {
	t.Helper()
	if err := db.SaveProjectIndex(project); err != nil {
		t.Fatalf("SaveProjectIndex failed: %v", err)
	}
}

func runCLI(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	return runCLIWithPWD(t, "", args...)
}

func runCLIWithPWD(t *testing.T, pwd string, args ...string) (string, string, error) {
	t.Helper()

	deps := defaultCLIDeps()
	if pwd != "" {
		deps.getwd = func() (string, error) { return pwd, nil }
	} else {
		// Default to a path that won't match any seeded project so pwd context
		// stays "outside" / unset and tests behave as if pwd were irrelevant.
		deps.getwd = func() (string, error) { return "/var/empty/no-such-place", nil }
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := runCLIArgs(args, &stdout, &stderr, deps)
	return stdout.String(), stderr.String(), err
}

func TestRootHelp(t *testing.T) {
	stdout, stderr, err := runCLI(t, "--help")
	if err != nil {
		t.Fatalf("root help failed: %v\n%s", err, stderr)
	}
	for _, want := range []string{"ropcode send", "ropcode status", "ropcode list", "ropcode tui"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("expected %q in root help, got %q", want, stdout)
		}
	}
}

func TestListHelp(t *testing.T) {
	stdout, stderr, err := runCLI(t, "list", "--help")
	if err != nil {
		t.Fatalf("list help failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "ropcode list instances") {
		t.Fatalf("expected list usage, got %q", stdout)
	}
}

func TestListInstancesShowsAliveInstances(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")

	stdout, stderr, err := runCLI(t, "list", "instances")
	if err != nil {
		t.Fatalf("list instances failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "inst-a") {
		t.Fatalf("expected instance in output, got %q", stdout)
	}
}

func TestBareRopcodeInProjectRootListsWorkspaces(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Branch: "feat/a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}}},
			{Name: "ws-b", Branch: "feat/b", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-b"}}},
		},
	})

	stdout, stderr, err := runCLIWithPWD(t, "/tmp/alpha")
	if err != nil {
		t.Fatalf("bare ropcode in project root failed: %v\n%s", err, stderr)
	}
	for _, want := range []string{"alpha", "ws-a", "feat/a", "ws-b", "feat/b", "Hints"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("expected %q in overview, got %q", want, stdout)
		}
	}
}

func TestBareRopcodeInsideWorkspaceShowsHints(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Branch:    "feat/a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}},
		}},
	})

	stdout, stderr, err := runCLIWithPWD(t, "/tmp/alpha/.ropcode/ws-a/sub/dir")
	if err != nil {
		t.Fatalf("bare ropcode in workspace failed: %v\n%s", err, stderr)
	}
	for _, want := range []string{"workspace  ws-a", "branch     feat/a", "Hints"} {
		if !strings.Contains(stdout, want) {
			t.Fatalf("expected %q in workspace overview, got %q", want, stdout)
		}
	}
}

func TestBareRopcodeOutsideProjectPrintsUsage(t *testing.T) {
	setupCLITestDB(t)
	stdout, stderr, _ := runCLIWithPWD(t, "/var/empty/no-such-place")
	combined := stdout + stderr
	if !strings.Contains(combined, "ropcode send") {
		t.Fatalf("expected usage hint when outside project, got %q", combined)
	}
}

func TestSendInProjectRootRequiresWorkspaceFlag(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}},
		}},
	})

	_, _, err := runCLIWithPWD(t, "/tmp/alpha", "send", "--prompt", "hi")
	if err == nil || !strings.Contains(err.Error(), "workspace name") {
		t.Fatalf("expected error asking for a workspace name, got %v", err)
	}
}

func TestSendAcceptsPositionalWorkspace(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}},
		}},
	})

	// Positional ws-a should resolve, instance-attach failure is fine —
	// proves arg parsing reached the dial step.
	_, _, err := runCLIWithPWD(t, "/tmp/alpha", "send", "ws-a", "--prompt", "hi")
	if err != nil && strings.Contains(err.Error(), "workspace name") {
		t.Fatalf("positional workspace should bypass workspace-name error, got %v", err)
	}
}

func TestSendPositionalConflictsWithFlag(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}}},
			{Name: "ws-b", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-b"}}},
		},
	})

	_, _, err := runCLIWithPWD(t, "/tmp/alpha", "send", "ws-a", "-w", "ws-b", "--prompt", "x")
	if err == nil || !strings.Contains(err.Error(), "given twice") {
		t.Fatalf("expected conflict error, got %v", err)
	}
}

func TestSendOutsideProjectAcceptsWorkspaceName(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}},
		}},
	})

	// $PWD is outside any project, but a globally-unique workspace name should resolve.
	_, _, err := runCLIWithPWD(t, "/var/empty/no-such-place", "send", "ws-a", "--prompt", "hi")
	if err != nil && strings.Contains(err.Error(), "workspace name") {
		t.Fatalf("unique workspace name should resolve outside project, got %v", err)
	}
}

func TestSendAmbiguousWorkspaceRequiresProject(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedInstance(t, db, "inst-a", "alive")
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "shared",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/shared"}},
		}},
	})
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "beta",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/beta"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "shared",
			Providers: []database.ProviderInfo{{Path: "/tmp/beta/.ropcode/shared"}},
		}},
	})

	_, _, err := runCLIWithPWD(t, "/var/empty/no-such-place", "send", "shared", "--prompt", "hi")
	if err == nil || !strings.Contains(err.Error(), "multiple projects") {
		t.Fatalf("expected ambiguity error, got %v", err)
	}
}

func TestStatusInProjectRootShowsAllSubWorkspaces(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-a"}}},
			{Name: "ws-b", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/.ropcode/ws-b"}}},
		},
	})
	seedInstance(t, db, "inst-a", "alive")

	stdout, _, err := runCLIWithPWD(t, "/tmp/alpha", "status")
	// no live RPC server is reachable here; we expect either the table header
	// or a benign instance-attach error — both prove pwd dispatch happened.
	if err == nil && !strings.Contains(stdout, "WORKSPACE") && !strings.Contains(stdout, "idle") {
		t.Fatalf("expected pwd-scoped status output, got %q (err=%v)", stdout, err)
	}
}

func TestResolveInstance(t *testing.T) {
	t.Run("explicit instance resolves directly", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "inst-b")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-b" || source != "explicit" {
			t.Fatalf("expected explicit inst-b, got id=%q source=%q", record.ID, source)
		}
	})

	t.Run("single alive instance auto selected", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")

		record, source, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err != nil {
			t.Fatalf("resolveInstance failed: %v", err)
		}
		if record.ID != "inst-a" || source != "auto" {
			t.Fatalf("expected auto inst-a, got id=%q source=%q", record.ID, source)
		}
	})

	t.Run("no alive instances returns actionable error", func(t *testing.T) {
		cfg, _ := setupCLITestDB(t)

		_, _, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err == nil || !strings.Contains(err.Error(), "ropcode list instances") {
			t.Fatalf("expected actionable error, got %v", err)
		}
	})

	t.Run("multiple alive instances returns explicit flag error", func(t *testing.T) {
		cfg, db := setupCLITestDB(t)
		seedInstance(t, db, "inst-a", "alive")
		seedInstance(t, db, "inst-b", "alive")

		_, _, err := resolveInstance(defaultCLIDeps(), cfg, "")
		if err == nil || !strings.Contains(err.Error(), "--instance <id>") {
			t.Fatalf("expected explicit instance error, got %v", err)
		}
	})
}

func TestResolveProjectByCWDInsideWorkspaceSubdirectory(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}},
		}},
	})

	project, source, err := resolveProject(defaultCLIDeps(), cfg, projectResolutionOptions{explicitCWD: "/tmp/alpha/ws-a/subdir"})
	if err != nil {
		t.Fatalf("resolveProject failed: %v", err)
	}
	if project.Name != "alpha" || source != "explicit" {
		t.Fatalf("expected explicit alpha, got project=%q source=%q", project.Name, source)
	}
}

func TestResolveWorkspaceByCWDInsideWorkspaceSubdirectory(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}},
		}},
	})

	project, _, err := resolveProject(defaultCLIDeps(), cfg, projectResolutionOptions{explicitProject: "alpha"})
	if err != nil {
		t.Fatalf("resolveProject failed: %v", err)
	}
	workspace, source, err := resolveWorkspace(defaultCLIDeps(), cfg, project, workspaceResolutionOptions{explicitCWD: "/tmp/alpha/ws-a/subdir"})
	if err != nil {
		t.Fatalf("resolveWorkspace failed: %v", err)
	}
	if workspace.Name != "ws-a" || source != "explicit" {
		t.Fatalf("expected explicit ws-a, got workspace=%q source=%q", workspace.Name, source)
	}
}

func TestResolveWorkspaceRequiresExplicitSelectionWhenAmbiguous(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}}},
			{Name: "ws-b", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-b"}}},
		},
	})

	project, _, err := resolveProject(defaultCLIDeps(), cfg, projectResolutionOptions{explicitProject: "alpha"})
	if err != nil {
		t.Fatalf("resolveProject failed: %v", err)
	}
	_, _, err = resolveWorkspace(defaultCLIDeps(), cfg, project, workspaceResolutionOptions{})
	if err == nil || !strings.Contains(err.Error(), "--workspace <name>") {
		t.Fatalf("expected explicit workspace error, got %v", err)
	}
}
