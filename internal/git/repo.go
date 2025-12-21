package git

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"

	"github.com/go-git/go-git/v5"
)

// Repo represents a Git repository
type Repo struct {
	path string
	repo *git.Repository
}

// FileStatus represents the status of a single file
type FileStatus struct {
	Path   string
	Status string // "modified", "added", "deleted", "untracked", etc.
}

// RepoStatus represents the current status of the repository
type RepoStatus struct {
	Branch    string
	Modified  []FileStatus
	Staged    []FileStatus
	Untracked []FileStatus
	IsClean   bool
}

// Open opens a git repository at the given path
func Open(path string) (*Repo, error) {
	repo, err := git.PlainOpen(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open git repository: %w", err)
	}

	return &Repo{
		path: path,
		repo: repo,
	}, nil
}

// Status returns the current status of the repository
func (r *Repo) Status() (*RepoStatus, error) {
	worktree, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("failed to get worktree: %w", err)
	}

	status, err := worktree.Status()
	if err != nil {
		return nil, fmt.Errorf("failed to get status: %w", err)
	}

	branch, err := r.CurrentBranch()
	if err != nil {
		branch = "" // Branch might not exist yet (empty repo)
	}

	repoStatus := &RepoStatus{
		Branch:    branch,
		Modified:  make([]FileStatus, 0),
		Staged:    make([]FileStatus, 0),
		Untracked: make([]FileStatus, 0),
		IsClean:   status.IsClean(),
	}

	for path, fileStatus := range status {
		fs := FileStatus{Path: path}

		// Check staging area status
		if fileStatus.Staging != git.Unmodified && fileStatus.Staging != git.Untracked {
			fs.Status = mapStatusCode(fileStatus.Staging)
			repoStatus.Staged = append(repoStatus.Staged, fs)
		}

		// Check worktree status
		if fileStatus.Worktree == git.Untracked {
			fs.Status = "untracked"
			repoStatus.Untracked = append(repoStatus.Untracked, fs)
		} else if fileStatus.Worktree != git.Unmodified {
			fs.Status = mapStatusCode(fileStatus.Worktree)
			repoStatus.Modified = append(repoStatus.Modified, fs)
		}
	}

	return repoStatus, nil
}

// mapStatusCode converts go-git status codes to human-readable strings
func mapStatusCode(code git.StatusCode) string {
	switch code {
	case git.Unmodified:
		return "unmodified"
	case git.Untracked:
		return "untracked"
	case git.Modified:
		return "modified"
	case git.Added:
		return "added"
	case git.Deleted:
		return "deleted"
	case git.Renamed:
		return "renamed"
	case git.Copied:
		return "copied"
	case git.UpdatedButUnmerged:
		return "updated-but-unmerged"
	default:
		return "unknown"
	}
}

// CurrentBranch returns the name of the current branch
// Uses git command instead of go-git because go-git doesn't handle worktrees correctly
func (r *Repo) CurrentBranch() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = r.path

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}

	branch := strings.TrimSpace(string(output))
	if branch == "HEAD" {
		return "", fmt.Errorf("HEAD is detached")
	}

	return branch, nil
}

// RunGitCommand executes a git command and returns the output
func (r *Repo) RunGitCommand(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = r.path

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("git command failed: %w, stderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}

// Diff returns the diff output for the repository
// If cached is true, returns staged changes; otherwise returns unstaged changes
func (r *Repo) Diff(cached bool) (string, error) {
	args := []string{"diff"}
	if cached {
		args = append(args, "--cached")
	}

	return r.RunGitCommand(args...)
}
