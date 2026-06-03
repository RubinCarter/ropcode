package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RendererLogger struct {
	Path string
	file *os.File
	mu   sync.Mutex
}

func ConfigureRendererLogging(home string) (*RendererLogger, func(), error) {
	logDir := filepath.Join(home, ".ropcode", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, nil, err
	}

	logName := timestampedRendererLogName(time.Now())
	logPath := filepath.Join(logDir, logName)
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	for suffix := 1; os.IsExist(err); suffix++ {
		logPath = filepath.Join(logDir, timestampedRendererLogNameWithSuffix(logName, suffix))
		file, err = os.OpenFile(logPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	}
	if err != nil {
		return nil, nil, err
	}

	logger := &RendererLogger{Path: logPath, file: file}
	return logger, func() { _ = file.Close() }, nil
}

func ConfigureRendererLoggingForCurrentUser() (*RendererLogger, func(), error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, nil, err
	}
	return ConfigureRendererLogging(home)
}

func (l *RendererLogger) Write(level string, scope string, args []interface{}) {
	if l == nil || l.file == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	_, _ = fmt.Fprintf(
		l.file,
		"%s [%s] [%s] %s\n",
		time.Now().UTC().Format(time.RFC3339Nano),
		normalizeRendererLogLevel(level),
		scope,
		formatRendererLogArgs(args),
	)
}

func normalizeRendererLogLevel(level string) string {
	switch level {
	case "log", "info", "warn", "error", "debug":
		return level
	default:
		return "log"
	}
}

func formatRendererLogArgs(args []interface{}) string {
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, fmt.Sprintf("%v", arg))
	}
	return strings.Join(parts, " ")
}

func timestampedRendererLogName(t time.Time) string {
	return "ropcode-renderer-" + t.Format("20060102-150405-000000000") + ".log"
}

func timestampedRendererLogNameWithSuffix(logName string, suffix int) string {
	ext := filepath.Ext(logName)
	base := strings.TrimSuffix(logName, ext)
	return fmt.Sprintf("%s-%d%s", base, suffix, ext)
}
