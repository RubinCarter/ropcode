//go:build !windows

package main

import (
	"path"
	"strings"
)

func normalizeGitObjectPath(gitPath string) string {
	gitPath = strings.TrimSpace(gitPath)
	gitPath = strings.TrimLeft(gitPath, "/")
	return path.Clean(gitPath)
}
