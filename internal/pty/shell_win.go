//go:build windows

package pty

import (
	"path/filepath"
	"strings"
)

const ShellTypeCmd = "cmd"

func getPlatformShellType(shellPath string) string {
	base := strings.ToLower(filepath.Base(shellPath))
	if base == "cmd" || base == "cmd.exe" {
		return ShellTypeCmd
	}
	return ""
}

func buildPlatformShellArgs(shellType string) ([]string, bool) {
	if shellType == ShellTypeCmd {
		return nil, true
	}
	return nil, false
}
