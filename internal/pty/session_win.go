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
		os.Getenv("COMSPEC"),
		"pwsh.exe",
		"powershell.exe",
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
