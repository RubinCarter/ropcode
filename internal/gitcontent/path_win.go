//go:build windows

package gitcontent

import (
	"path"
	"strings"
)

func NormalizeGitObjectPath(gitPath string) string {
	gitPath = strings.TrimSpace(strings.ReplaceAll(gitPath, "\\", "/"))
	gitPath = strings.TrimLeft(gitPath, "/")
	return path.Clean(gitPath)
}
