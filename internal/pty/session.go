//go:build !windows

// internal/pty/session.go
package pty

import "os"

func normalizeCwd(cwd string) string {
	return cwd
}

// detectDefaultShell finds the default shell (internal, not cached)
func detectDefaultShell() string {
	// First try SHELL environment variable
	if shell := os.Getenv("SHELL"); shell != "" {
		// Verify it exists before using it
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}

	// Common shell locations to try
	shells := []string{
		"/bin/zsh",
		"/usr/bin/zsh",
		"/opt/homebrew/bin/zsh",
		"/bin/bash",
		"/usr/bin/bash",
		"/bin/sh",
		"/usr/bin/sh",
	}

	for _, shell := range shells {
		if _, err := os.Stat(shell); err == nil {
			return shell
		}
	}

	// Last resort
	return "/bin/sh"
}
