//go:build wails && !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configureServerProcessPlatform(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return nil
}

func registerServerProcess(_ *exec.Cmd) error {
	return nil
}

func terminateServerProcessPlatform(cmd *exec.Cmd, done <-chan struct{}, timeout time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("no running process")
	}

	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		pgid = pid
	}
	if err := syscall.Kill(-pgid, syscall.SIGINT); err != nil {
		if signalErr := cmd.Process.Signal(os.Interrupt); signalErr != nil {
			return killServerProcessPlatform(cmd)
		}
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		return nil
	case <-timer.C:
		return killServerProcessPlatform(cmd)
	}
}

func killServerProcessPlatform(cmd *exec.Cmd) error {
	pid := cmd.Process.Pid
	if pgid, err := syscall.Getpgid(pid); err == nil {
		if err := syscall.Kill(-pgid, syscall.SIGKILL); err == nil {
			return nil
		}
	}
	return cmd.Process.Kill()
}

func cleanupServerProcessPlatform(_ *exec.Cmd) {}
