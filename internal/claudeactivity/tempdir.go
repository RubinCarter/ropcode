//go:build !windows

package claudeactivity

import (
	"os"
	"path/filepath"
)

func ClaudeTempDir() string {
	if value := os.Getenv("CLAUDE_CODE_TMPDIR"); value != "" {
		return value
	}
	return filepath.Join(os.TempDir(), "claude")
}
