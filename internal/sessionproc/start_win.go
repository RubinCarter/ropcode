//go:build windows

package sessionproc

import "os/exec"

func Start(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	register(cmd)
	return nil
}
