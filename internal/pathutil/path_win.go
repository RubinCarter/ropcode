//go:build windows

package pathutil

import (
	"path/filepath"
	"strings"
)

func NormalizeClientPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return path
	}
	if len(path) >= 4 && path[0] == '/' && ((path[1] >= 'A' && path[1] <= 'Z') || (path[1] >= 'a' && path[1] <= 'z')) && path[2] == ':' && (path[3] == '\\' || path[3] == '/') {
		path = path[1:]
	}
	return filepath.Clean(path)
}
