package logging

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestConfigureServerLoggingCreatesTimestampedLogFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)

	logPath, cleanup, err := ConfigureServerLogging()
	if err != nil {
		t.Fatalf("ConfigureServerLogging failed: %v", err)
	}
	defer cleanup()

	wantDir := filepath.Join(home, ".ropcode", "logs")
	if filepath.Dir(logPath) != wantDir {
		t.Fatalf("log path dir %q, want %q", filepath.Dir(logPath), wantDir)
	}

	namePattern := regexp.MustCompile(`^ropcode-server-\d{8}-\d{6}-\d{9}(?:-\d+)?\.log$`)
	if !namePattern.MatchString(filepath.Base(logPath)) {
		t.Fatalf("log file name %q does not include timestamp", filepath.Base(logPath))
	}

	log.Print("diagnostic line")

	content, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(content), "diagnostic line") {
		t.Fatalf("expected diagnostic line in log, got %q", string(content))
	}
}

func TestConfigureServerLoggingCreatesNewFileForEachStartup(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)

	firstPath, firstCleanup, err := ConfigureServerLogging()
	if err != nil {
		t.Fatalf("first ConfigureServerLogging failed: %v", err)
	}
	firstCleanup()

	secondPath, secondCleanup, err := ConfigureServerLogging()
	if err != nil {
		t.Fatalf("second ConfigureServerLogging failed: %v", err)
	}
	defer secondCleanup()

	if firstPath == secondPath {
		t.Fatalf("expected a new log file per startup, got same path %q", firstPath)
	}
	if _, err := os.Stat(firstPath); err != nil {
		t.Fatalf("first log file missing: %v", err)
	}
	if _, err := os.Stat(secondPath); err != nil {
		t.Fatalf("second log file missing: %v", err)
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("stderr unavailable")
}

func TestConfigureServerLoggingStillWritesFileWhenStderrFails(t *testing.T) {
	home := t.TempDir()

	logPath, cleanup, err := configureServerLogging(home, failingWriter{})
	if err != nil {
		t.Fatalf("configureServerLogging failed: %v", err)
	}
	defer cleanup()

	log.Print("wails startup diagnostic")

	content, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(content), "wails startup diagnostic") {
		t.Fatalf("expected diagnostic line in log, got %q", string(content))
	}
}
