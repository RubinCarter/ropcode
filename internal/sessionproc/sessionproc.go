package sessionproc

import (
	"os/exec"
	"time"
)

const gracefulTimeout = 5 * time.Second

// Configure prepares a provider CLI command for later tree termination.
func Configure(cmd *exec.Cmd) error {
	return configure(cmd)
}

// Terminate interrupts a provider CLI and forcefully terminates its process tree
// if it does not exit within the graceful timeout.
func Terminate(cmd *exec.Cmd, done <-chan struct{}) error {
	return terminate(cmd, done, gracefulTimeout)
}

// Cleanup releases resources associated with a command after it exits naturally.
func Cleanup(cmd *exec.Cmd) {
	cleanup(cmd)
}
