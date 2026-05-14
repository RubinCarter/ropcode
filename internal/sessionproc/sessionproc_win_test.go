//go:build windows

package sessionproc

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

const processQueryLimitedInformation = 0x1000

func TestTerminateKillsWindowsChildProcessTree(t *testing.T) {
	pidFile := t.TempDir() + `\child.pid`
	script := fmt.Sprintf(
		`$p = Start-Process -PassThru -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60'; Set-Content -LiteralPath %q -Value $p.Id; Start-Sleep -Seconds 60`,
		pidFile,
	)

	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	if err := Configure(cmd); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}
	if err := Start(cmd); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()

	childPID := waitForPIDFile(t, pidFile)
	if !processExists(childPID) {
		t.Fatalf("child process %d was not running before terminate", childPID)
	}

	if err := terminate(cmd, done, 100*time.Millisecond); err != nil {
		t.Fatalf("terminate failed: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("parent process did not exit after terminate")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !processExists(childPID) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("child process %d survived provider process-tree termination", childPID)
}

func waitForPIDFile(t *testing.T, path string) int {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if parseErr != nil {
				t.Fatalf("failed to parse child pid: %v", parseErr)
			}
			return pid
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("timed out waiting for child pid file")
	return 0
}

func processExists(pid int) bool {
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false
	}
	_ = syscall.CloseHandle(handle)
	return true
}
