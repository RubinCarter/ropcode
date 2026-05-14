package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestReadGitFileAtHeadReturnsCommittedContent(t *testing.T) {
	repoPath := setupGitContentTestRepo(t)
	filePath := filepath.Join(repoPath, "bindings.go")

	if err := os.WriteFile(filePath, []byte("current\n"), 0644); err != nil {
		t.Fatalf("failed to modify file: %v", err)
	}

	got, err := (&App{}).ReadGitFileAtHead(repoPath, "bindings.go")
	if err != nil {
		t.Fatalf("ReadGitFileAtHead failed: %v", err)
	}
	if got != "original\n" {
		t.Fatalf("expected committed content, got %q", got)
	}
}

func TestReadGitFileAtHeadRejectsParentTraversal(t *testing.T) {
	repoPath := setupGitContentTestRepo(t)

	if _, err := (&App{}).ReadGitFileAtHead(repoPath, "../outside.txt"); err == nil {
		t.Fatal("expected parent traversal path to be rejected")
	}
}

func TestReadGitFileAtHeadReturnsEmptyForNewFile(t *testing.T) {
	repoPath := setupGitContentTestRepo(t)

	got, err := (&App{}).ReadGitFileAtHead(repoPath, "new-file.go")
	if err != nil {
		t.Fatalf("ReadGitFileAtHead failed: %v", err)
	}
	if got != "" {
		t.Fatalf("expected empty content for file absent from HEAD, got %q", got)
	}
}

func setupGitContentTestRepo(t *testing.T) string {
	t.Helper()

	repoPath := t.TempDir()
	runGitContentTestCommand(t, repoPath, "git", "init")
	runGitContentTestCommand(t, repoPath, "git", "config", "user.name", "Test User")
	runGitContentTestCommand(t, repoPath, "git", "config", "user.email", "test@example.com")

	if err := os.WriteFile(filepath.Join(repoPath, "bindings.go"), []byte("original\n"), 0644); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}
	runGitContentTestCommand(t, repoPath, "git", "add", "bindings.go")
	runGitContentTestCommand(t, repoPath, "git", "commit", "-m", "add bindings")

	return repoPath
}

func runGitContentTestCommand(t *testing.T, dir, name string, args ...string) {
	t.Helper()

	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v failed: %v\n%s", name, args, err, string(output))
	}
}
