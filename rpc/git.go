package rpc

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ropcode/internal/git"
	"ropcode/internal/gitcontent"
)

func GitHandlers(_ *Deps) map[string]Handler {
	return map[string]Handler{
		"GetGitStatus": func(p json.RawMessage) (any, error) {
			path := argString(p, 0)
			repo, err := git.Open(path)
			if err != nil {
				return nil, err
			}
			status, err := repo.Status()
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"branch":    status.Branch,
				"modified":  status.Modified,
				"staged":    status.Staged,
				"untracked": status.Untracked,
				"is_clean":  status.IsClean,
			}, nil
		},
		"GetCurrentBranch": func(p json.RawMessage) (any, error) {
			repo, err := git.Open(argString(p, 0))
			if err != nil {
				if git.IsRepositoryNotExists(err) {
					return "", nil
				}
				return "", err
			}
			return repo.CurrentBranch()
		},
		"GetGitDiff": func(p json.RawMessage) (any, error) {
			repo, err := git.Open(argString(p, 0))
			if err != nil {
				return "", err
			}
			return repo.Diff(argBool(p, 1))
		},
		"IsGitRepository": func(p json.RawMessage) (any, error) {
			_, err := git.Open(argString(p, 0))
			return err == nil, nil
		},
		"DetectWorktree": func(p json.RawMessage) (any, error) {
			return detectWorktree(argString(p, 0))
		},
		"PushToMainWorktree": func(p json.RawMessage) (any, error) {
			return pushToMainWorktree(argString(p, 0))
		},
		"GetUnpushedCommitsCount": func(p json.RawMessage) (any, error) {
			return getUnpushedCommitsCount(argString(p, 0))
		},
		"PushToRemote": func(p json.RawMessage) (any, error) {
			return pushToRemote(argString(p, 0))
		},
		"GetUnpushedToRemoteCount": func(p json.RawMessage) (any, error) {
			return getUnpushedToRemoteCount(argString(p, 0))
		},
		"CheckWorkspaceClean": func(p json.RawMessage) (any, error) {
			return nil, checkWorkspaceClean(argString(p, 0))
		},
		"CleanupWorkspace": func(p json.RawMessage) (any, error) {
			return cleanupWorkspace(argString(p, 0))
		},
		"InitLocalGit": func(p json.RawMessage) (any, error) {
			return nil, initLocalGit(argString(p, 0), argBool(p, 1))
		},
		"ReadGitFileAtHead": func(p json.RawMessage) (any, error) {
			return gitcontent.ReadGitFileAtHead(argString(p, 0), argString(p, 1))
		},
		"RenameGitBranch": func(p json.RawMessage) (any, error) {
			return renameGitBranch(argString(p, 0), argString(p, 1))
		},
		"CloneRepository": func(p json.RawMessage) (any, error) {
			return cloneRepository(argString(p, 0), argString(p, 1), argString(p, 2))
		},
	}
}

type worktreeInfo struct {
	CurrentPath     string `json:"current_path"`
	RootPath        string `json:"root_path"`
	MainBranch      string `json:"main_branch"`
	IsWorktreeChild bool   `json:"is_worktree"`
}

func detectWorktree(path string) (*worktreeInfo, error) {
	gitPath := filepath.Join(path, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return &worktreeInfo{CurrentPath: path, RootPath: path, IsWorktreeChild: false}, nil
	}

	isWorktree := !info.IsDir()
	rootPath := path
	mainBranch := "main"

	if isWorktree {
		data, err := os.ReadFile(gitPath)
		if err == nil {
			content := strings.TrimSpace(string(data))
			if strings.HasPrefix(content, "gitdir:") {
				gitDir := strings.TrimSpace(strings.TrimPrefix(content, "gitdir:"))
				if strings.Contains(gitDir, "worktrees") {
					parts := strings.Split(gitDir, "worktrees")
					if len(parts) > 0 {
						mainGitDir := strings.TrimSuffix(parts[0], string(filepath.Separator))
						rootPath = filepath.Dir(mainGitDir)
					}
				}
			}
		}
	}

	repo, err := git.Open(rootPath)
	if err == nil {
		if branch, err := repo.CurrentBranch(); err == nil {
			mainBranch = branch
		}
	}

	return &worktreeInfo{
		CurrentPath:     path,
		RootPath:        rootPath,
		MainBranch:      mainBranch,
		IsWorktreeChild: isWorktree,
	}, nil
}

func pushToMainWorktree(path string) (string, error) {
	wt, err := detectWorktree(path)
	if err != nil {
		return "", err
	}
	if !wt.IsWorktreeChild {
		return "", fmt.Errorf("current directory is not a worktree child")
	}

	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch := strings.TrimSpace(string(output))

	cmd = exec.Command("git", "status", "--porcelain")
	cmd.Dir = wt.RootPath
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to check main worktree status: %w", err)
	}
	if len(strings.TrimSpace(string(output))) > 0 {
		return "", fmt.Errorf("main worktree has uncommitted changes. Please commit or stash them first")
	}

	cmd = exec.Command("git", "rev-parse", currentBranch)
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get branch SHA: %w", err)
	}
	branchSHA := strings.TrimSpace(string(output))

	cmd = exec.Command("git", "merge", "--no-edit", branchSHA, "-m", "Merge from worktree: "+currentBranch)
	cmd.Dir = wt.RootPath
	output, err = cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		if strings.Contains(outputStr, "CONFLICT") || strings.Contains(outputStr, "conflict") {
			abortCmd := exec.Command("git", "merge", "--abort")
			abortCmd.Dir = wt.RootPath
			abortCmd.Run()
			return "", fmt.Errorf("cannot push to main: merge would result in conflicts")
		}
		if strings.Contains(outputStr, "Already up to date") {
			return "Already up to date. Nothing to push.", nil
		}
		return "", fmt.Errorf("failed to merge: %s", outputStr)
	}

	return fmt.Sprintf("Successfully pushed %s to %s at %s", currentBranch, wt.MainBranch, wt.RootPath), nil
}

func getUnpushedCommitsCount(path string) (int, error) {
	wt, err := detectWorktree(path)
	if err != nil {
		return 0, err
	}
	if !wt.IsWorktreeChild {
		return 0, nil
	}

	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return 0, nil
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return 0, nil
	}

	cmd = exec.Command("git", "rev-list", "--count", fmt.Sprintf("%s..%s", wt.MainBranch, currentBranch))
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return 0, nil
	}

	var count int
	fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
	return count, nil
}

func pushToRemote(path string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return "", fmt.Errorf("not on a valid branch")
	}

	cmd = exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = path
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("no remote 'origin' configured")
	}

	cmd = exec.Command("git", "fetch", "origin")
	cmd.Dir = path
	cmd.Run()

	remoteBranch := fmt.Sprintf("refs/remotes/origin/%s", currentBranch)
	cmd = exec.Command("git", "rev-parse", "--verify", "--quiet", remoteBranch)
	cmd.Dir = path
	remoteBranchExists := cmd.Run() == nil

	var pushArgs []string
	if remoteBranchExists {
		pushArgs = []string{"push", "origin", currentBranch}
	} else {
		pushArgs = []string{"push", "-u", "origin", currentBranch}
	}

	cmd = exec.Command("git", pushArgs...)
	cmd.Dir = path
	output, err = cmd.CombinedOutput()
	if err != nil {
		outputStr := string(output)
		if strings.Contains(outputStr, "non-fast-forward") || strings.Contains(outputStr, "rejected") {
			return "", fmt.Errorf("push rejected: pull latest changes first")
		}
		return "", fmt.Errorf("push failed: %s", outputStr)
	}

	return fmt.Sprintf("Successfully pushed %s to origin", currentBranch), nil
}

func getUnpushedToRemoteCount(path string) (int, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return 0, nil
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return 0, nil
	}

	remoteBranch := fmt.Sprintf("refs/remotes/origin/%s", currentBranch)
	cmd = exec.Command("git", "rev-parse", "--verify", "--quiet", remoteBranch)
	cmd.Dir = path
	if cmd.Run() != nil {
		cmd = exec.Command("git", "rev-list", "--count", currentBranch)
		cmd.Dir = path
		output, err = cmd.Output()
		if err != nil {
			return 0, nil
		}
		var count int
		fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
		return count, nil
	}

	cmd = exec.Command("git", "rev-list", "--count", fmt.Sprintf("%s..HEAD", remoteBranch))
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return 0, nil
	}
	var count int
	fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
	return count, nil
}

func checkWorkspaceClean(path string) error {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to check workspace status: %w", err)
	}
	if len(strings.TrimSpace(string(output))) > 0 {
		return fmt.Errorf("workspace has uncommitted changes")
	}

	count, err := getUnpushedCommitsCount(path)
	if err != nil {
		return nil
	}
	if count > 0 {
		return fmt.Errorf("workspace has %d unpushed commit(s) not merged to main branch", count)
	}
	return nil
}

func cleanupWorkspace(path string) (string, error) {
	repo, err := git.Open(path)
	if err != nil {
		return "", err
	}

	var ops []string

	currentBranch, err := repo.CurrentBranch()
	if err != nil || currentBranch == "" || currentBranch == "HEAD" {
		return "", fmt.Errorf("not on a valid branch")
	}

	if _, err := repo.RunGitCommand("reset", "--hard", "HEAD"); err != nil {
		return "", fmt.Errorf("failed to reset changes: %w", err)
	}
	ops = append(ops, "Reset all uncommitted changes")

	if _, err := repo.RunGitCommand("clean", "-fd"); err != nil {
		return "", fmt.Errorf("failed to clean untracked files: %w", err)
	}
	ops = append(ops, "Removed all untracked files and directories")

	remoteBranchFull := fmt.Sprintf("refs/remotes/origin/%s", currentBranch)
	cmd := exec.Command("git", "rev-parse", "--verify", remoteBranchFull)
	cmd.Dir = path
	if cmd.Run() == nil {
		if _, err := repo.RunGitCommand("reset", "--hard", remoteBranchFull); err != nil {
			return "", fmt.Errorf("failed to reset to remote branch: %w", err)
		}
		ops = append(ops, fmt.Sprintf("Reset branch '%s' to match remote", currentBranch))
	} else {
		wt, err := detectWorktree(path)
		if err == nil && wt.IsWorktreeChild {
			if _, err := repo.RunGitCommand("reset", "--hard", wt.MainBranch); err != nil {
				return "", fmt.Errorf("failed to reset to main branch: %w", err)
			}
			ops = append(ops, fmt.Sprintf("Reset worktree branch '%s' to match main branch '%s'", currentBranch, wt.MainBranch))
		} else {
			ops = append(ops, "No remote branch found, keeping local commits")
		}
	}

	return fmt.Sprintf("Workspace cleanup completed successfully:\n%s", strings.Join(ops, "\n")), nil
}

func initLocalGit(path string, commitAll bool) error {
	projectName := filepath.Base(path)
	if projectName == "" || projectName == "." || projectName == "/" {
		return fmt.Errorf("invalid project path: %s", path)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	hash := fmt.Sprintf("%x", sha256Sum([]byte(path)))[:8]
	bareDir := filepath.Join(homeDir, ".ropcode", "local-git", fmt.Sprintf("%s-%s.git", projectName, hash))

	if err := os.MkdirAll(filepath.Dir(bareDir), 0755); err != nil {
		return fmt.Errorf("failed to create local-git directory: %w", err)
	}

	if _, err := os.Stat(bareDir); os.IsNotExist(err) {
		output, err := exec.Command("git", "init", "--bare", bareDir).CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to create bare repository: %s, %w", string(output), err)
		}
	}

	repo, err := git.Open(path)
	if err != nil {
		output, err := exec.Command("git", "init", path).CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to init repository: %s, %w", string(output), err)
		}
		repo, err = git.Open(path)
		if err != nil {
			return fmt.Errorf("failed to open repository after init: %w", err)
		}
	}

	output, err := repo.RunGitCommand("remote", "get-url", "origin")
	if err != nil {
		repo.RunGitCommand("remote", "add", "origin", bareDir)
	} else if strings.TrimSpace(output) != bareDir {
		// Origin exists but points elsewhere, leave it
	}

	gitignorePath := filepath.Join(path, ".gitignore")
	if _, err := os.Stat(gitignorePath); os.IsNotExist(err) {
		os.WriteFile(gitignorePath, []byte(".git\n.conductor\n.idea\n.ropcode\n"), 0644)
	}

	if commitAll {
		repo.RunGitCommand("add", ".")
		status, _ := repo.RunGitCommand("status", "--porcelain")
		if strings.TrimSpace(status) != "" {
			repo.RunGitCommand("commit", "-m", "Initial commit")
		}
		currentBranch, _ := repo.RunGitCommand("rev-parse", "--abbrev-ref", "HEAD")
		currentBranch = strings.TrimSpace(currentBranch)
		if currentBranch != "main" && currentBranch != "" {
			repo.RunGitCommand("branch", "-M", "main")
		}
		if _, err := repo.RunGitCommand("push", "-u", "origin", "main"); err != nil {
			if currentBranch != "" && currentBranch != "main" {
				repo.RunGitCommand("push", "-u", "origin", currentBranch)
			}
		}
	}

	return nil
}

func renameGitBranch(projectPath, newBranch string) (string, error) {
	cmd := exec.Command("git", "branch", "-m", newBranch)
	cmd.Dir = projectPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to rename branch: %s", string(output))
	}
	return newBranch, nil
}

func cloneRepository(repoUrl, destPath, branch string) (any, error) {
	args := []string{"clone"}
	if branch != "" {
		args = append(args, "-b", branch)
	}
	args = append(args, repoUrl)
	if destPath != "" {
		args = append(args, destPath)
	}

	cmd := exec.Command("git", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git clone failed: %s - %s", err.Error(), string(output))
	}

	actualPath := destPath
	if actualPath == "" {
		parts := strings.Split(repoUrl, "/")
		repoName := parts[len(parts)-1]
		repoName = strings.TrimSuffix(repoName, ".git")
		cwd, _ := os.Getwd()
		actualPath = filepath.Join(cwd, repoName)
	}

	return map[string]any{
		"id":         filepath.Base(actualPath),
		"path":       actualPath,
		"sessions":   []string{},
		"created_at": time.Now().Unix(),
	}, nil
}

func sha256Sum(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}
