//go:build !windows

package main

import "ropcode/internal/gitcontent"

func normalizeGitObjectPath(gitPath string) string {
	return gitcontent.NormalizeGitObjectPath(gitPath)
}
