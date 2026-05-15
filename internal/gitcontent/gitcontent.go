package gitcontent

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"ropcode/internal/pathutil"
)

// ReadGitFileAtHead returns a file's content from HEAD for the diff viewer.
func ReadGitFileAtHead(workspacePath, gitPath string) (string, error) {
	workspacePath = pathutil.NormalizeClientPath(workspacePath)
	gitPath = NormalizeGitObjectPath(gitPath)

	if gitPath == "." || strings.HasPrefix(gitPath, "../") || gitPath == ".." {
		return "", fmt.Errorf("invalid git path: %s", gitPath)
	}

	cmd := exec.Command("git", "show", "HEAD:"+gitPath)
	cmd.Dir = workspacePath

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", fmt.Errorf("git executable not found: %w", err)
		}
		if isMissingGitHeadPath(stderr.String()) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read %s from HEAD: %w, stderr: %s", gitPath, err, strings.TrimSpace(stderr.String()))
	}

	return stdout.String(), nil
}

func isMissingGitHeadPath(stderr string) bool {
	// English git messages
	if strings.Contains(stderr, "does not exist in 'HEAD'") ||
		strings.Contains(stderr, "exists on disk, but not in 'HEAD'") ||
		strings.Contains(stderr, "Invalid object name 'HEAD'") {
		return true
	}
	// Chinese git messages (zh_CN locale)
	if strings.Contains(stderr, "不在 'HEAD' 中") ||
		strings.Contains(stderr, "在磁盘上存在，但不在 'HEAD' 中") {
		return true
	}
	return false
}
