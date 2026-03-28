package main

import (
	"strings"
	"testing"

	"ropcode/internal/database"
)

func seedProjectIndex(t *testing.T, db *database.Database, project *database.ProjectIndex) {
	t.Helper()
	if err := db.SaveProjectIndex(project); err != nil {
		t.Fatalf("SaveProjectIndex failed: %v", err)
	}
}

func TestCatalogShowsProjectsWhenProjectFilterIsSet(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
	})

	stdout, stderr, err := runCLI(t, "catalog", "--project", "alpha")
	if err != nil {
		t.Fatalf("catalog project failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "project\talpha") {
		t.Fatalf("expected project in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "path\t/tmp/alpha") {
		t.Fatalf("expected project path in output, got %q", stdout)
	}
}

func TestResolveProject_WithCWDInsideWorkspaceSubdirectory(t *testing.T) {
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
