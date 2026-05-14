//go:build !windows

package pty

func getPlatformShellType(shellPath string) string {
	return ""
}

func buildPlatformShellArgs(shellType string) ([]string, bool) {
	return nil, false
}
