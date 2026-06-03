//go:build !windows && !darwin

package notifications

import "os/exec"

type platformSender struct{}

func NewPlatformSender() Sender {
	return platformSender{}
}

func (platformSender) Send(event SessionFinished) error {
	if _, err := exec.LookPath("notify-send"); err != nil {
		return nil
	}
	return exec.Command("notify-send", notificationTitle(event), notificationBody(event)).Run()
}
