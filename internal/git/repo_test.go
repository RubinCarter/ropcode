package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// setupTestRepo creates a temporary git repository for testing
func setupTestRepo(t *testing.T) (string, func()) {
	t.Helper()

	// Create temporary directory
	tmpDir, err := os.MkdirTemp("", "git-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}

	// Initialize git repository
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git user for the test repo
	cmd = exec.Command("git", "config", "user.name", "Test User")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to configure git user.name: %v", err)
	}

	cmd = exec.Command("git", "config", "user.email", "test@example.com")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to configure git user.email: %v", err)
	}

	return tmpDir, cleanup
}

// commitFile creates a file and commits it
func commitFile(t *testing.T, repoPath, filename, content string) {
	t.Helper()

	filePath := filepath.Join(repoPath, filename)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	cmd := exec.Command("git", "add", filename)
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Add "+filename)
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit file: %v", err)
	}
}

func TestOpen(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}
	if repo == nil {
		t.Fatal("Expected non-nil repo")
	}
}

func TestOpenNonExistentRepo(t *testing.T) {
	_, err := Open("/non/existent/path")
	if err == nil {
		t.Fatal("Expected error when opening non-existent repo")
	}
}

func TestCurrentBranch(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create an initial commit (required for branch to exist)
	commitFile(t, repoPath, "README.md", "# Test")

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	branch, err := repo.CurrentBranch()
	if err != nil {
		t.Fatalf("Failed to get current branch: %v", err)
	}

	// Default branch should be 'master' or 'main' depending on git config
	if branch != "master" && branch != "main" {
		t.Errorf("Expected branch to be 'master' or 'main', got %q", branch)
	}
}

func TestStatus_CleanRepo(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create initial commit
	commitFile(t, repoPath, "README.md", "# Test")

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	status, err := repo.Status()
	if err != nil {
		t.Fatalf("Failed to get status: %v", err)
	}

	if !status.IsClean {
		t.Error("Expected clean repository")
	}
	if len(status.Modified) != 0 {
		t.Errorf("Expected no modified files, got %d", len(status.Modified))
	}
	if len(status.Staged) != 0 {
		t.Errorf("Expected no staged files, got %d", len(status.Staged))
	}
	if len(status.Untracked) != 0 {
		t.Errorf("Expected no untracked files, got %d", len(status.Untracked))
	}
}

func TestStatus_UntrackedFiles(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create initial commit
	commitFile(t, repoPath, "README.md", "# Test")

	// Create untracked file
	untrackedFile := filepath.Join(repoPath, "new.txt")
	if err := os.WriteFile(untrackedFile, []byte("new content"), 0644); err != nil {
		t.Fatalf("Failed to create untracked file: %v", err)
	}

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	status, err := repo.Status()
	if err != nil {
		t.Fatalf("Failed to get status: %v", err)
	}

	if status.IsClean {
		t.Error("Expected dirty repository")
	}
	if len(status.Untracked) != 1 {
		t.Errorf("Expected 1 untracked file, got %d", len(status.Untracked))
	}
	if len(status.Untracked) > 0 && status.Untracked[0].Path != "new.txt" {
		t.Errorf("Expected untracked file 'new.txt', got %q", status.Untracked[0].Path)
	}
}

func TestStatus_ModifiedFiles(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create and commit file
	commitFile(t, repoPath, "test.txt", "original content")

	// Modify the file
	modifiedFile := filepath.Join(repoPath, "test.txt")
	if err := os.WriteFile(modifiedFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("Failed to modify file: %v", err)
	}

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	status, err := repo.Status()
	if err != nil {
		t.Fatalf("Failed to get status: %v", err)
	}

	if status.IsClean {
		t.Error("Expected dirty repository")
	}
	if len(status.Modified) != 1 {
		t.Errorf("Expected 1 modified file, got %d", len(status.Modified))
	}
	if len(status.Modified) > 0 && status.Modified[0].Path != "test.txt" {
		t.Errorf("Expected modified file 'test.txt', got %q", status.Modified[0].Path)
	}
}

func TestStatus_StagedFiles(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create initial commit
	commitFile(t, repoPath, "README.md", "# Test")

	// Create and stage a new file
	newFile := filepath.Join(repoPath, "staged.txt")
	if err := os.WriteFile(newFile, []byte("staged content"), 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	cmd := exec.Command("git", "add", "staged.txt")
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to stage file: %v", err)
	}

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	status, err := repo.Status()
	if err != nil {
		t.Fatalf("Failed to get status: %v", err)
	}

	if status.IsClean {
		t.Error("Expected dirty repository")
	}
	if len(status.Staged) != 1 {
		t.Errorf("Expected 1 staged file, got %d", len(status.Staged))
	}
	if len(status.Staged) > 0 && status.Staged[0].Path != "staged.txt" {
		t.Errorf("Expected staged file 'staged.txt', got %q", status.Staged[0].Path)
	}
}

func TestRunGitCommand(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create initial commit
	commitFile(t, repoPath, "README.md", "# Test")

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	// Test git log command
	output, err := repo.RunGitCommand("log", "--oneline")
	if err != nil {
		t.Fatalf("Failed to run git command: %v", err)
	}

	if len(output) == 0 {
		t.Error("Expected non-empty output from git log")
	}
}

func TestDiff_Unstaged(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create and commit file
	commitFile(t, repoPath, "test.txt", "original content")

	// Modify the file
	modifiedFile := filepath.Join(repoPath, "test.txt")
	if err := os.WriteFile(modifiedFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("Failed to modify file: %v", err)
	}

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	// Get unstaged diff
	diff, err := repo.Diff(false)
	if err != nil {
		t.Fatalf("Failed to get diff: %v", err)
	}

	if len(diff) == 0 {
		t.Error("Expected non-empty diff output")
	}
	// The diff should contain the filename
	if len(diff) > 0 && !contains(diff, "test.txt") {
		t.Error("Expected diff to contain 'test.txt'")
	}
}

func TestDiff_Staged(t *testing.T) {
	repoPath, cleanup := setupTestRepo(t)
	defer cleanup()

	// Create and commit file
	commitFile(t, repoPath, "test.txt", "original content")

	// Modify and stage the file
	modifiedFile := filepath.Join(repoPath, "test.txt")
	if err := os.WriteFile(modifiedFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("Failed to modify file: %v", err)
	}

	cmd := exec.Command("git", "add", "test.txt")
	cmd.Dir = repoPath
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to stage file: %v", err)
	}

	repo, err := Open(repoPath)
	if err != nil {
		t.Fatalf("Failed to open repository: %v", err)
	}

	// Get staged diff
	diff, err := repo.Diff(true)
	if err != nil {
		t.Fatalf("Failed to get diff: %v", err)
	}

	if len(diff) == 0 {
		t.Error("Expected non-empty diff output")
	}
	// The diff should contain the filename
	if len(diff) > 0 && !contains(diff, "test.txt") {
		t.Error("Expected diff to contain 'test.txt'")
	}
}

// Helper function to check if string contains substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
