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

func TestProjectListCommand(t *testing.T) {
	_, db := setupCLITestDB(t)
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "alpha",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/alpha"}},
	})
	seedProjectIndex(t, db, &database.ProjectIndex{
		Name:      "beta",
		Available: true,
		Providers: []database.ProviderInfo{{Path: "/tmp/beta"}},
	})

	stdout, stderr, err := runCLI(t, "project", "list")
	if err != nil {
		t.Fatalf("project list failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "PROJECT\tPATH") {
		t.Fatalf("expected header in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "alpha\t/tmp/alpha") {
		t.Fatalf("expected alpha project in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "beta\t/tmp/beta") {
		t.Fatalf("expected beta project in output, got %q", stdout)
	}
}

func TestProjectShowCommand_UsesSavedContext(t *testing.T) {
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

	stdout, stderr, err := runCLI(t, "project", "show", "alpha")
	if err != nil {
		t.Fatalf("project show failed: %v\n%s", err, stderr)
	}
	if !strings.Contains(stdout, "project\talpha") {
		t.Fatalf("expected project name in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "project_source\texplicit") {
		t.Fatalf("expected explicit source in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "path\t/tmp/alpha") {
		t.Fatalf("expected project path in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "workspaces\t1") {
		t.Fatalf("expected workspace count in output, got %q", stdout)
	}
	if !strings.Contains(stdout, "saved_project\talpha") {
		t.Fatalf("expected saved project context in output, got %q", stdout)
	}
}
