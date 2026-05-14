//go:build !windows

package sessionproc

import "os/exec"

func Start(cmd *exec.Cmd) error {
	return cmd.Start()
}
