package logging

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func ConfigureServerLogging() (string, func(), error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", nil, err
	}

	logDir := filepath.Join(home, ".ropcode", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return "", nil, err
	}

	logName := timestampedServerLogName(time.Now())
	logPath := filepath.Join(logDir, logName)
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	for suffix := 1; os.IsExist(err); suffix++ {
		logPath = filepath.Join(logDir, timestampedServerLogNameWithSuffix(logName, suffix))
		file, err = os.OpenFile(logPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	}
	if err != nil {
		return "", nil, err
	}

	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.Lshortfile)
	log.SetOutput(io.MultiWriter(os.Stderr, file))

	cleanup := func() {
		log.SetOutput(os.Stderr)
		_ = file.Close()
	}

	return logPath, cleanup, nil
}

func timestampedServerLogName(t time.Time) string {
	return "ropcode-server-" + t.Format("20060102-150405-000000000") + ".log"
}

func timestampedServerLogNameWithSuffix(logName string, suffix int) string {
	ext := filepath.Ext(logName)
	base := strings.TrimSuffix(logName, ext)
	return fmt.Sprintf("%s-%d%s", base, suffix, ext)
}
