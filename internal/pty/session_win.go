//go:build windows

package pty

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func normalizeCwd(cwd string) string {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return cwd
	}
	if len(cwd) >= 4 && cwd[0] == '/' && ((cwd[1] >= 'A' && cwd[1] <= 'Z') || (cwd[1] >= 'a' && cwd[1] <= 'z')) && cwd[2] == ':' && (cwd[3] == '\\' || cwd[3] == '/') {
		cwd = cwd[1:]
	}
	return filepath.Clean(cwd)
}

func detectDefaultShell() string {
	for _, shell := range []string{
		os.Getenv("ROPCODE_SHELL"),
		"pwsh.exe",
		"powershell.exe",
		findInstalledGitBash(),
		os.Getenv("COMSPEC"),
		"cmd.exe",
	} {
		if shell == "" {
			continue
		}
		if filepath.IsAbs(shell) {
			if _, err := os.Stat(shell); err == nil {
				return shell
			}
			continue
		}
		if path, err := exec.LookPath(shell); err == nil {
			return path
		}
	}
	return "cmd.exe"
}

func findInstalledGitBash() string {
	pathEnv := os.Getenv("PATH")
	for _, dir := range filepath.SplitList(pathEnv) {
		dir = strings.Trim(dir, `"`)
		if !pathHasPart(dir, "git") || pathHasPart(dir, "system32") {
			continue
		}
		bashPath := filepath.Join(dir, "bash.exe")
		if _, err := os.Stat(bashPath); err == nil {
			return bashPath
		}
	}
	userProfile := os.Getenv("USERPROFILE")
	if userProfile != "" {
		for _, bashPath := range []string{
			filepath.Join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe"),
		} {
			if _, err := os.Stat(bashPath); err == nil {
				return bashPath
			}
		}
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData != "" {
		bashPath := filepath.Join(localAppData, "programs", "git", "bin", "bash.exe")
		if _, err := os.Stat(bashPath); err == nil {
			return bashPath
		}
	}
	programFilesPath := filepath.Join("C:\\", "Program Files", "Git", "bin", "bash.exe")
	if _, err := os.Stat(programFilesPath); err == nil {
		return programFilesPath
	}
	return ""
}

func pathHasPart(pathValue, part string) bool {
	part = strings.ToLower(part)
	cleaned := filepath.Clean(pathValue)
	for {
		if strings.ToLower(filepath.Base(cleaned)) == part {
			return true
		}
		parent := filepath.Dir(cleaned)
		if parent == cleaned {
			return false
		}
		cleaned = parent
	}
}
