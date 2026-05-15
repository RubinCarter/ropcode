//go:build !windows

package main

import (
	"ropcode/internal/command"
)

func (a *App) ExecuteCommand(cmd string, cwd string) CommandResult {
	r := command.Execute(cmd, cwd)
	return CommandResult{Success: r.Success, Output: r.Output, Error: r.Error}
}
