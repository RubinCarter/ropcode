//go:build windows

package main

import "syscall"

var (
	kernel32Wails3Console = syscall.NewLazyDLL("kernel32.dll")
	user32Wails3Console   = syscall.NewLazyDLL("user32.dll")
	procWails3AllocConsole     = kernel32Wails3Console.NewProc("AllocConsole")
	procWails3GetConsoleWindow = kernel32Wails3Console.NewProc("GetConsoleWindow")
	procWails3ShowWindow       = user32Wails3Console.NewProc("ShowWindow")
)

const wails3SwHide = 0

func attachHiddenConsole() {
	_, _, _ = procWails3AllocConsole.Call()
	hwnd, _, _ := procWails3GetConsoleWindow.Call()
	if hwnd != 0 {
		_, _, _ = procWails3ShowWindow.Call(hwnd, wails3SwHide)
	}
}
