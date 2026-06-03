//go:build windows

package notifications

import (
	"fmt"
	"os"

	toast "git.sr.ht/~jackmordaunt/go-toast/v2"
)

const (
	windowsToastAppID            = "Ropcode"
	windowsToastActivationArgs   = "ropcode://notification/session-finished"
	windowsToastActivatorGUID    = "{7B1C86A1-9457-45C1-9026-7D51BE9D8205}"
	windowsToastActivationExeEnv = "ROPCODE_NOTIFICATION_ACTIVATION_EXE"
)

var (
	windowsExecutable                 = os.Executable
	windowsToastSetAppData            = toast.SetAppData
	windowsToastSetActivationCallback = toast.SetActivationCallback
	windowsToastPush                  = func(notification toast.Notification) error {
		return notification.Push()
	}
)

type platformSender struct{}

func NewPlatformSender() Sender {
	return platformSender{}
}

func (platformSender) Send(event SessionFinished) error {
	exePath, err := windowsActivationExe()
	if err != nil {
		return fmt.Errorf("resolve windows notification activation exe: %w", err)
	}
	if err := windowsToastSetAppData(toast.AppData{
		AppID:         windowsToastAppID,
		GUID:          windowsToastActivatorGUID,
		ActivationExe: exePath,
	}); err != nil {
		return fmt.Errorf("register windows notification app data: %w", err)
	}
	windowsToastSetActivationCallback(func(string, []toast.UserData) {
		focusRopcodeWindow()
	})
	notification := toast.Notification{
		AppID:               windowsToastAppID,
		Title:               notificationTitle(event),
		Body:                notificationBody(event),
		ActivationType:      toast.Foreground,
		ActivationArguments: windowsToastActivationArgs,
		ActivationExe:       exePath,
	}
	if err := windowsToastPush(notification); err != nil {
		return fmt.Errorf("send windows notification: %w", err)
	}
	return nil
}

func windowsActivationExe() (string, error) {
	if value := os.Getenv(windowsToastActivationExeEnv); value != "" {
		return value, nil
	}
	return windowsExecutable()
}
