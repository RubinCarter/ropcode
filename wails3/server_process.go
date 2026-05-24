package main

import (
	"os/exec"
	"time"
)

const serverGracefulTimeout = 5 * time.Second

func configureServerProcess(cmd *exec.Cmd) error {
	return configureServerProcessPlatform(cmd)
}

func startServerProcess(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	if err := registerServerProcess(cmd); err != nil {
		_ = cmd.Process.Kill()
		return err
	}
	return nil
}

func terminateServerProcess(cmd *exec.Cmd, done <-chan struct{}) error {
	return terminateServerProcessPlatform(cmd, done, serverGracefulTimeout)
}

func cleanupServerProcess(cmd *exec.Cmd) {
	cleanupServerProcessPlatform(cmd)
}
