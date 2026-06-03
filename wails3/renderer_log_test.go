package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestCreateRendererLoggerWritesTimestampedRendererLog(t *testing.T) {
	home := t.TempDir()

	logger, cleanup, err := createRendererLogger(home)
	if err != nil {
		t.Fatalf("createRendererLogger failed: %v", err)
	}
	defer cleanup()

	wantDir := filepath.Join(home, ".ropcode", "logs")
	if filepath.Dir(logger.path) != wantDir {
		t.Fatalf("log path dir %q, want %q", filepath.Dir(logger.path), wantDir)
	}

	namePattern := regexp.MustCompile(`^ropcode-renderer-\d{8}-\d{6}-\d{9}(?:-\d+)?\.log$`)
	if !namePattern.MatchString(filepath.Base(logger.path)) {
		t.Fatalf("log file name %q does not include timestamp", filepath.Base(logger.path))
	}

	logger.write("warn", "renderer-debug-log", []interface{}{"front end warning", map[string]interface{}{"line": float64(7)}})
	cleanup()

	content, err := os.ReadFile(logger.path)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	text := string(content)
	for _, needle := range []string{"[warn]", "[renderer-debug-log]", "front end warning", "line"} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected %q in renderer log, got %q", needle, text)
		}
	}
}
