//go:build !windows

package command

import (
	"bytes"
	"os/exec"
)

// Execute runs a shell command synchronously and returns the output.
func Execute(command string, cwd string) Result {
	shellCmd := exec.Command("sh", "-c", command)
	return run(shellCmd, cwd)
}

func run(shellCmd *exec.Cmd, cwd string) Result {
	if cwd != "" {
		shellCmd.Dir = cwd
	}

	var stdout, stderr bytes.Buffer
	shellCmd.Stdout = &stdout
	shellCmd.Stderr = &stderr

	err := shellCmd.Run()
	if err != nil {
		return Result{
			Success: false,
			Output:  stdout.String(),
			Error:   stderr.String() + ": " + err.Error(),
		}
	}

	return Result{
		Success: true,
		Output:  stdout.String(),
		Error:   stderr.String(),
	}
}
