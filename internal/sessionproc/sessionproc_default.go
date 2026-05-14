//go:build !windows

package sessionproc

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configure(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
	return nil
}

func terminate(cmd *exec.Cmd, done <-chan struct{}, timeout time.Duration) error {
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
			return kill(cmd)
		}
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-done:
		return nil
	case <-timer.C:
		return kill(cmd)
	}
}

func kill(cmd *exec.Cmd) error {
	pid := cmd.Process.Pid
	pgid, err := syscall.Getpgid(pid)
	if err == nil {
		if killErr := syscall.Kill(-pgid, syscall.SIGKILL); killErr == nil {
			return nil
		}
	}
	return cmd.Process.Kill()
}

func cleanup(cmd *exec.Cmd) {
}
