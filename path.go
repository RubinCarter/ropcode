//go:build !windows

package main

func normalizeClientPath(path string) string {
	return path
}
