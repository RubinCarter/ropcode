//go:build darwin

package notifications

import "os/exec"

type platformSender struct{}

func NewPlatformSender() Sender {
	return platformSender{}
}

func (platformSender) Send(event SessionFinished) error {
	return exec.Command("osascript",
		"-e",
		`display notification `+appleScriptQuote(notificationBody(event))+` with title `+appleScriptQuote(notificationTitle(event)),
	).Run()
}

func appleScriptQuote(value string) string {
	escaped := ""
	for _, r := range value {
		if r == '\\' || r == '"' {
			escaped += "\\"
		}
		escaped += string(r)
	}
	return `"` + escaped + `"`
}
