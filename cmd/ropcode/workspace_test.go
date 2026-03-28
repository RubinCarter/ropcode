package main

import (
	"strings"
	"testing"

	"ropcode/internal/database"
)

func TestCatalogShowsWorkspaceWhenLayeredFlagsProvided(t *testing.T) {
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

	stdout, stderr, err := runCLI(t, "catalog", "--project", "alpha", "--workspace", "ws-a")
	if err != nil {
		t.Fatalf("catalog workspace failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "workspace\tws-a") {
		t.Fatalf("expected workspace in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "cwd\t/tmp/alpha/ws-a") {
		t.Fatalf("expected workspace cwd in output, got %q", stdout)
	}
}

func TestCatalogShowsWorkspaceForGlobalCWDFlag(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
		Workspaces: []database.WorkspaceIndex{{
			Name:      "ws-a",
			Providers: []database.ProviderInfo{{Path: "/tmp/alpha/ws-a"}},
		}},
	})

	stdout, stderr, err := runCLI(t, "catalog", "--project", "alpha", "--workspace", "ws-a", "--cwd", "/tmp/alpha/ws-a/subdir")
	if err != nil {
		t.Fatalf("catalog cwd failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "cwd\t/tmp/alpha/ws-a") {
		t.Fatalf("expected workspace cwd in output, got %q", stdout)
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

func TestResolveWorkspace_RequiresExplicitSelectionWhenAmbiguous(t *testing.T) {
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
