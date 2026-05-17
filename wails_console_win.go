//go:build wails && windows

package main

import "syscall"

var (
	kernel32WailsConsole = syscall.NewLazyDLL("kernel32.dll")
	user32WailsConsole   = syscall.NewLazyDLL("user32.dll")
	procAllocConsole     = kernel32WailsConsole.NewProc("AllocConsole")
	procGetConsoleWindow = kernel32WailsConsole.NewProc("GetConsoleWindow")
	procShowWindow       = user32WailsConsole.NewProc("ShowWindow")
)

const swHide = 0

func attachHiddenConsole() {
	_, _, _ = procAllocConsole.Call()
	hwnd, _, _ := procGetConsoleWindow.Call()
	if hwnd != 0 {
		_, _, _ = procShowWindow.Call(hwnd, swHide)
	}
}
