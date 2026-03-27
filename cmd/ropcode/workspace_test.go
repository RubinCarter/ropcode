package main

import (
	"strings"
	"testing"

	"ropcode/internal/database"
)

func TestWorkspaceListCommand_UsesProjectFlag(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}}},
			{Name: "ws-b", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-b"}}},
		},
	})

	stdout, stderr, err := runCLI(t, "workspace", "list", "--project", "alpha")
	if err != nil {
		t.Fatalf("workspace list failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "WORKSPACE\tPATH") {
		t.Fatalf("expected header in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "ws-a\t/tmp/alpha/ws-a") {
		t.Fatalf("expected ws-a in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "ws-b\t/tmp/alpha/ws-b") {
		t.Fatalf("expected ws-b in output, got %q", stdout)
	}
}

func TestWorkspaceListCommand_UsesSavedProjectContext(t *testing.T) {
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

	if err := saveCLIContext(cfg, cliContext{CurrentProject: "alpha", CurrentProjectPath: "/tmp/alpha"}); err != nil {
		t.Fatalf("saveCLIContext failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "workspace", "list")
	if err != nil {
		t.Fatalf("workspace list failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "ws-a\t/tmp/alpha/ws-a") {
		t.Fatalf("expected ws-a in output, got %q", stdout)
	}
}

func TestWorkspaceUseCommand_SavesWorkspaceContext(t *testing.T) {
	cfg, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{
			{Name: "ws-a", Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}}},
		},
	})

	stdout, stderr, err := runCLI(t, "workspace", "use", "--project", "alpha", "ws-a")
	if err != nil {
		t.Fatalf("workspace use failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "current workspace set to ws-a") {
		t.Fatalf("expected selection output, got %q", stdout)
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		t.Fatalf("loadCLIContext failed: %v", err)
	}
	if ctx.CurrentProject != "alpha" {
		t.Fatalf("expected current project alpha, got %q", ctx.CurrentProject)
	}
	if ctx.CurrentProjectPath != "/tmp/alpha" {
		t.Fatalf("expected current project path /tmp/alpha, got %q", ctx.CurrentProjectPath)
	}
	if ctx.CurrentWorkspace != "ws-a" {
		t.Fatalf("expected current workspace ws-a, got %q", ctx.CurrentWorkspace)
	}
	if ctx.CurrentWorkspacePath != "/tmp/alpha/ws-a" {
		t.Fatalf("expected current workspace path /tmp/alpha/ws-a, got %q", ctx.CurrentWorkspacePath)
	}
	if ctx.CurrentCWD != "/tmp/alpha/ws-a" {
		t.Fatalf("expected current cwd /tmp/alpha/ws-a, got %q", ctx.CurrentCWD)
	}
}

func TestWorkspaceUseCommand_UsesSavedProjectContext(t *testing.T) {
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

	if err := saveCLIContext(cfg, cliContext{CurrentProject: "alpha", CurrentProjectPath: "/tmp/alpha"}); err != nil {
		t.Fatalf("saveCLIContext failed: %v", err)
	}

	stdout, stderr, err := runCLI(t, "workspace", "use", "ws-a")
	if err != nil {
		t.Fatalf("workspace use failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "current workspace set to ws-a") {
		t.Fatalf("expected selection output, got %q", stdout)
	}
}

func TestResolveWorkspace_WithCWDInsideWorkspaceSubdirectory(t *testing.T) {
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
