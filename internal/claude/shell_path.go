//go:build !windows

package claude

import (
	"log"
	"os"
	"os/exec"
	"strings"
)

// ensureFullShellPath ensures the environment has the full PATH from user's login shell.
// This is necessary because GUI apps (like Electron) don't inherit shell PATH on macOS.
func ensureFullShellPath(env []string) []string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-l", "-c", "echo $PATH")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("[Session] Failed to get shell PATH: %v, using current PATH", err)
		return env
	}

	shellPath := strings.TrimSpace(string(output))
	if shellPath == "" {
		return env
	}

	pathFound := false
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = "PATH=" + shellPath
			pathFound = true
			log.Printf("[Session] Updated PATH from login shell")
			break
		}
	}

	if !pathFound {
		env = append(env, "PATH="+shellPath)
		log.Printf("[Session] Added PATH from login shell")
	}

	return env
}
