package logging

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestConfigureRendererLoggingCreatesTimestampedLogFile(t *testing.T) {
	home := t.TempDir()

	logger, cleanup, err := ConfigureRendererLogging(home)
	if err != nil {
		t.Fatalf("ConfigureRendererLogging failed: %v", err)
	}
	defer cleanup()

	wantDir := filepath.Join(home, ".ropcode", "logs")
	if filepath.Dir(logger.Path) != wantDir {
		t.Fatalf("log path dir %q, want %q", filepath.Dir(logger.Path), wantDir)
	}

	namePattern := regexp.MustCompile(`^ropcode-renderer-\d{8}-\d{6}-\d{9}(?:-\d+)?\.log$`)
	if !namePattern.MatchString(filepath.Base(logger.Path)) {
		t.Fatalf("log file name %q does not include timestamp", filepath.Base(logger.Path))
	}

	logger.Write("error", "renderer-debug-log", []interface{}{"frontend failure", map[string]interface{}{"source": "test"}})
	cleanup()

	content, err := os.ReadFile(logger.Path)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	text := string(content)
	for _, needle := range []string{"[error]", "[renderer-debug-log]", "frontend failure", "source"} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected %q in renderer log, got %q", needle, text)
		}
	}
}
