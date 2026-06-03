//go:build windows

package notifications

import (
	"errors"
	"os"
	"testing"

	toast "git.sr.ht/~jackmordaunt/go-toast/v2"
)

func TestWindowsSenderRegistersToastActivationData(t *testing.T) {
	originalSetAppData := windowsToastSetAppData
	originalPush := windowsToastPush
	originalExecutable := windowsExecutable
	defer func() {
		windowsToastSetAppData = originalSetAppData
		windowsToastPush = originalPush
		windowsExecutable = originalExecutable
	}()

	windowsExecutable = func() (string, error) {
		return `C:\Program Files\Ropcode\Ropcode.exe`, nil
	}

	var registered toast.AppData
	windowsToastSetAppData = func(data toast.AppData) error {
		registered = data
		return nil
	}

	var pushed toast.Notification
	windowsToastPush = func(notification toast.Notification) error {
		pushed = notification
		return nil
	}

	if err := (platformSender{}).Send(SessionFinished{Provider: "claude", Status: "completed", Cwd: `E:\repo`}); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	if registered.AppID != windowsToastAppID {
		t.Fatalf("expected app id %q, got %#v", windowsToastAppID, registered)
	}
	if registered.GUID == "" {
		t.Fatalf("expected activation GUID, got %#v", registered)
	}
	if registered.ActivationExe != `C:\Program Files\Ropcode\Ropcode.exe` {
		t.Fatalf("expected activation exe, got %#v", registered)
	}
	if pushed.ActivationType != toast.Foreground {
		t.Fatalf("expected foreground activation, got %#v", pushed)
	}
	if pushed.ActivationArguments != windowsToastActivationArgs {
		t.Fatalf("expected activation args %q, got %#v", windowsToastActivationArgs, pushed)
	}
	if pushed.ActivationExe != `C:\Program Files\Ropcode\Ropcode.exe` {
		t.Fatalf("expected notification activation exe, got %#v", pushed)
	}
}

func TestWindowsSenderReturnsExecutableLookupError(t *testing.T) {
	originalExecutable := windowsExecutable
	defer func() { windowsExecutable = originalExecutable }()

	windowsExecutable = func() (string, error) {
		return "", errors.New("missing exe")
	}

	if err := (platformSender{}).Send(SessionFinished{}); err == nil {
		t.Fatal("expected executable lookup error")
	}
}

func TestWindowsSenderPrefersShellActivationExeFromEnvironment(t *testing.T) {
	originalSetAppData := windowsToastSetAppData
	originalPush := windowsToastPush
	originalExecutable := windowsExecutable
	defer func() {
		windowsToastSetAppData = originalSetAppData
		windowsToastPush = originalPush
		windowsExecutable = originalExecutable
	}()
	t.Setenv(windowsToastActivationExeEnv, `C:\Program Files\Ropcode\Ropcode.exe`)

	windowsExecutable = func() (string, error) {
		return `C:\Program Files\Ropcode\ropcode-server.exe`, nil
	}

	var registered toast.AppData
	windowsToastSetAppData = func(data toast.AppData) error {
		registered = data
		return nil
	}

	var pushed toast.Notification
	windowsToastPush = func(notification toast.Notification) error {
		pushed = notification
		return nil
	}

	if err := (platformSender{}).Send(SessionFinished{}); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	if registered.ActivationExe != `C:\Program Files\Ropcode\Ropcode.exe` {
		t.Fatalf("expected shell activation exe from env, got %#v", registered)
	}
	if pushed.ActivationExe != `C:\Program Files\Ropcode\Ropcode.exe` {
		t.Fatalf("expected notification activation exe from env, got %#v", pushed)
	}

	if os.Getenv(windowsToastActivationExeEnv) == "" {
		t.Fatalf("expected %s to stay set for test", windowsToastActivationExeEnv)
	}
}

func TestWindowsSenderRegistersActivationCallback(t *testing.T) {
	originalSetAppData := windowsToastSetAppData
	originalPush := windowsToastPush
	originalExecutable := windowsExecutable
	originalSetActivationCallback := windowsToastSetActivationCallback
	defer func() {
		windowsToastSetAppData = originalSetAppData
		windowsToastPush = originalPush
		windowsExecutable = originalExecutable
		windowsToastSetActivationCallback = originalSetActivationCallback
	}()

	windowsExecutable = func() (string, error) {
		return `C:\Program Files\Ropcode\Ropcode.exe`, nil
	}
	windowsToastSetAppData = func(data toast.AppData) error { return nil }
	windowsToastPush = func(notification toast.Notification) error { return nil }

	callbacks := 0
	windowsToastSetActivationCallback = func(func(string, []toast.UserData)) {
		callbacks++
	}

	if err := (platformSender{}).Send(SessionFinished{}); err != nil {
		t.Fatalf("Send failed: %v", err)
	}
	if callbacks != 1 {
		t.Fatalf("expected activation callback registration, got %d", callbacks)
	}
}
