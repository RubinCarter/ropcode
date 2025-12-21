// +build !darwin

package main

// ToggleNativeFullscreen is a no-op on non-macOS platforms
func ToggleNativeFullscreen() {
	// Not supported on this platform
}

// IsNativeFullscreen always returns false on non-macOS platforms
func IsNativeFullscreen() bool {
	return false
}
