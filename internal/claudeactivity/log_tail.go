package claudeactivity

import (
	"bytes"
	"fmt"
	"os"
	"strings"
)

const maxTailBytes = 256 * 1024

func (s *Service) GetLogTail(sessionID, activityID string, maxLines int) (LogTail, error) {
	if maxLines <= 0 || maxLines > 500 {
		maxLines = 80
	}

	s.mu.RLock()
	bucket := s.buckets[sessionID]
	if bucket == nil {
		s.mu.RUnlock()
		return LogTail{}, fmt.Errorf("session not found: %s", sessionID)
	}
	activity := bucket.activities[activityID]
	if activity == nil {
		s.mu.RUnlock()
		return LogTail{}, fmt.Errorf("activity not found: %s", activityID)
	}
	path := activity.OutputFile
	s.mu.RUnlock()

	tail := LogTail{
		SessionID:      sessionID,
		ActivityID:     activityID,
		Path:           path,
		RequestedLines: maxLines,
		ResolvedBy:     "output_file",
	}
	if path == "" {
		tail.Error = "activity has no output file"
		return tail, nil
	}

	content, bytesRead, truncatedBytes, err := readLastBytes(path, maxTailBytes)
	tail.BytesRead = bytesRead
	tail.TruncatedBytes = truncatedBytes
	if err != nil {
		if os.IsNotExist(err) {
			tail.Error = err.Error()
			return tail, nil
		}
		return tail, err
	}
	tail.PathExists = true

	lines := splitLines(content)
	tail.LineCount = len(lines)
	if len(lines) > maxLines {
		tail.TruncatedLines = len(lines) - maxLines
		lines = lines[len(lines)-maxLines:]
	}
	tail.Content = strings.Join(lines, "\n")
	return tail, nil
}

func readLastBytes(path string, maxBytes int64) ([]byte, int64, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, 0, err
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return nil, 0, 0, err
	}

	size := stat.Size()
	start := int64(0)
	truncated := int64(0)
	if size > maxBytes {
		start = size - maxBytes
		truncated = start
	}
	if _, err := file.Seek(start, 0); err != nil {
		return nil, 0, 0, err
	}
	buf := make([]byte, size-start)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		return nil, int64(n), truncated, err
	}
	return buf[:n], int64(n), truncated, nil
}

func splitLines(content []byte) []string {
	content = bytes.TrimRight(content, "\r\n")
	if len(content) == 0 {
		return []string{}
	}
	raw := strings.Split(string(content), "\n")
	for i := range raw {
		raw[i] = strings.TrimRight(raw[i], "\r")
	}
	return raw
}
