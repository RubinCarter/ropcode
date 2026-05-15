//go:build !windows

package main

import "ropcode/internal/pathutil"

func normalizeClientPath(path string) string {
	return pathutil.NormalizeClientPath(path)
}
