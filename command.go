//go:build !windows

package main

import (
	"bytes"
	"os/exec"
)

// ExecuteCommand executes a shell command synchronously and returns the output.
// This version accepts a single shell command string (compatible with Electron/Tauri API).
func (a *App) ExecuteCommand(command string, cwd string) CommandResult {
	shellCmd := exec.Command("sh", "-c", command)
	return runShellCommand(shellCmd, cwd)
}

func runShellCommand(shellCmd *exec.Cmd, cwd string) CommandResult {
	if cwd != "" {
		shellCmd.Dir = cwd
	}

	var stdout, stderr bytes.Buffer
	shellCmd.Stdout = &stdout
	shellCmd.Stderr = &stderr

	err := shellCmd.Run()
	if err != nil {
		return CommandResult{
			Success: false,
			Output:  stdout.String(),
			Error:   stderr.String() + ": " + err.Error(),
		}
	}

	return CommandResult{
		Success: true,
		Output:  stdout.String(),
		Error:   stderr.String(),
	}
}
