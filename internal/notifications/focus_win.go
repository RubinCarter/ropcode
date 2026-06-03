//go:build windows

package notifications

import (
	"syscall"
	"unsafe"
)

const (
	swRestore = 9
)

var (
	user32Notifications          = syscall.NewLazyDLL("user32.dll")
	procEnumWindowsNotifications = user32Notifications.NewProc("EnumWindows")
	procGetWindowTextLengthW     = user32Notifications.NewProc("GetWindowTextLengthW")
	procGetWindowTextW           = user32Notifications.NewProc("GetWindowTextW")
	procGetClassNameW            = user32Notifications.NewProc("GetClassNameW")
	procIsWindowVisible          = user32Notifications.NewProc("IsWindowVisible")
	procShowWindowNotifications  = user32Notifications.NewProc("ShowWindow")
	procSetForegroundWindow      = user32Notifications.NewProc("SetForegroundWindow")
)

func focusRopcodeWindow() {
	hwnd := findRopcodeWindow()
	if hwnd == 0 {
		return
	}
	_, _, _ = procShowWindowNotifications.Call(hwnd, swRestore)
	_, _, _ = procSetForegroundWindow.Call(hwnd)
}

func findRopcodeWindow() uintptr {
	var found uintptr
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}
		title := windowText(hwnd)
		className := windowClassName(hwnd)
		if title == "Ropcode" || className == "RopcodeWails3Window" {
			found = hwnd
			return 0
		}
		return 1
	})
	_, _, _ = procEnumWindowsNotifications.Call(cb, 0)
	return found
}

func windowText(hwnd uintptr) string {
	length, _, _ := procGetWindowTextLengthW.Call(hwnd)
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	_, _, _ = procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf)
}

func windowClassName(hwnd uintptr) string {
	buf := make([]uint16, 256)
	_, _, _ = procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf)
}
