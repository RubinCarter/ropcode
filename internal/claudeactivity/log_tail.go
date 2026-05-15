package claudeactivity

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
	activityType := activity.Type
	claudeHomeDir := s.claudeHomeDir
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
		if activityType != ActivityTypeLocalAgent {
			return tail, nil
		}
	}

	content, bytesRead, truncatedBytes, err := readLastBytes(path, maxTailBytes)
	tail.BytesRead = bytesRead
	tail.TruncatedBytes = truncatedBytes
	if err != nil {
		if os.IsNotExist(err) {
			tail.Error = err.Error()
			if activityType != ActivityTypeLocalAgent {
				return tail, nil
			}
		} else {
			return tail, err
		}
	} else {
		tail.PathExists = true
		if bytesRead > 0 || activityType != ActivityTypeLocalAgent {
			fillTailContent(&tail, content, maxLines)
			return tail, nil
		}
	}

	if activityType != ActivityTypeLocalAgent {
		return tail, nil
	}

	fallbackPath := resolveClaudeSubagentTranscript(claudeHomeDir, path, activityID)
	if fallbackPath == "" || fallbackPath == path {
		fallbackPath = findClaudeSubagentTranscript(claudeHomeDir, activityID)
		if fallbackPath == "" || fallbackPath == path {
			return tail, nil
		}
	}
	fallbackContent, fallbackBytesRead, fallbackTruncatedBytes, fallbackErr := readLastBytes(fallbackPath, maxTailBytes)
	if fallbackErr != nil {
		if os.IsNotExist(fallbackErr) {
			return tail, nil
		}
		return tail, fallbackErr
	}
	tail.Path = fallbackPath
	tail.ResolvedBy = "claude_subagent_transcript"
	tail.PathExists = true
	tail.BytesRead = fallbackBytesRead
	tail.TruncatedBytes = fallbackTruncatedBytes
	tail.Error = ""
	fillTailContent(&tail, fallbackContent, maxLines)
	return tail, nil
}

func fillTailContent(tail *LogTail, content []byte, maxLines int) {
	lines := splitLines(content)
	tail.LineCount = len(lines)
	if len(lines) > maxLines {
		tail.TruncatedLines = len(lines) - maxLines
		lines = lines[len(lines)-maxLines:]
	} else {
		tail.TruncatedLines = 0
	}
	tail.Content = strings.Join(lines, "\n")
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

func resolveClaudeSubagentTranscript(claudeHomeDir, outputPath, activityID string) string {
	if claudeHomeDir == "" || activityID == "" {
		return ""
	}
	projectSlug, claudeSessionID := parseClaudeOutputPath(outputPath)
	if projectSlug == "" || claudeSessionID == "" {
		return ""
	}
	return filepath.Join(claudeHomeDir, "projects", projectSlug, claudeSessionID, "subagents", "agent-"+activityID+".jsonl")
}

func findClaudeSubagentTranscript(claudeHomeDir, activityID string) string {
	if claudeHomeDir == "" || activityID == "" {
		return ""
	}
	root := filepath.Join(claudeHomeDir, "projects")
	pattern := filepath.Join(root, "*", "*", "subagents", "agent-"+activityID+".jsonl")
	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		return ""
	}
	sort.SliceStable(matches, func(i, j int) bool {
		left, leftErr := os.Stat(matches[i])
		right, rightErr := os.Stat(matches[j])
		if leftErr != nil || rightErr != nil {
			return matches[i] > matches[j]
		}
		return left.ModTime().After(right.ModTime())
	})
	return matches[0]
}

func parseClaudeOutputPath(outputPath string) (string, string) {
	if outputPath == "" {
		return "", ""
	}
	cleaned := filepath.Clean(outputPath)
	parts := strings.FieldsFunc(cleaned, func(r rune) bool {
		return r == '/' || r == '\\'
	})
	for i := 0; i+3 < len(parts); i++ {
		if parts[i] == "claude" && parts[i+3] == "tasks" {
			return parts[i+1], parts[i+2]
		}
	}
	return "", ""
}
