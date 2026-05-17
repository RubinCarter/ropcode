package claudeactivity

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const (
	initialLineWindow = 80
	chunkLineCap      = 80
	chunkByteCap      = 256 * 1024
)

// ReadSubagentLog reads a slice of a local_agent JSONL transcript.
//
//   - since == -1: return the last initialLineWindow complete lines, with
//     TruncatedBefore set to max(0, totalLines-initialLineWindow).
//   - since >= 0: return [since, totalLines), capped by chunkLineCap and
//     chunkByteCap.
//
// The function is stateless; every call re-reads the file. Half-lines (no
// trailing \n) are excluded from TotalLines.
func (s *Service) ReadSubagentLog(sessionID, activityID string, since int) (SubagentLogChunk, error) {
	s.mu.RLock()
	bucket := s.buckets[sessionID]
	if bucket == nil {
		s.mu.RUnlock()
		return SubagentLogChunk{}, fmt.Errorf("session not found: %s", sessionID)
	}
	activity := bucket.activities[activityID]
	if activity == nil {
		s.mu.RUnlock()
		return SubagentLogChunk{}, fmt.Errorf("activity not found: %s", activityID)
	}
	if activity.Type != ActivityTypeLocalAgent {
		s.mu.RUnlock()
		return SubagentLogChunk{}, fmt.Errorf("activity %s is not a local_agent", activityID)
	}
	outputPath := activity.OutputFile
	claudeHomeDir := s.claudeHomeDir
	s.mu.RUnlock()

	chunk := SubagentLogChunk{
		SessionID:  sessionID,
		ActivityID: activityID,
	}

	path, resolvedBy := resolveSubagentPath(outputPath, activityID, claudeHomeDir)
	if path == "" {
		chunk.FileMissing = true
		chunk.Lines = []string{}
		return chunk, nil
	}

	chunk.Path = path
	chunk.ResolvedBy = resolvedBy

	lines, totalLines, err := readJSONLLines(path, since)
	if err != nil {
		if os.IsNotExist(err) {
			chunk.FileMissing = true
			chunk.Lines = []string{}
			return chunk, nil
		}
		return chunk, err
	}

	chunk.TotalLines = totalLines

	if since == -1 {
		// Initial load: return the last initialLineWindow lines.
		startLine := 0
		if totalLines > initialLineWindow {
			startLine = totalLines - initialLineWindow
		}
		chunk.TruncatedBefore = startLine
		chunk.Lines = lines[startLine:]
		chunk.NextLineIndex = totalLines
		return chunk, nil
	}

	if since > totalLines {
		// File shrank or rotated; signal client to refetch.
		chunk.FileMissing = true
		chunk.Lines = []string{}
		return chunk, nil
	}

	if since == totalLines {
		chunk.Lines = []string{}
		chunk.NextLineIndex = totalLines
		return chunk, nil
	}

	// Incremental: [since, totalLines) capped by chunkLineCap / chunkByteCap.
	end := totalLines
	if end-since > chunkLineCap {
		end = since + chunkLineCap
	}

	out := make([]string, 0, end-since)
	bytesUsed := 0
	for i := since; i < end; i++ {
		bytesUsed += len(lines[i]) + 1 // +1 for the stripped \n
		if bytesUsed > chunkByteCap && len(out) > 0 {
			end = i
			break
		}
		out = append(out, lines[i])
	}
	chunk.Lines = out
	chunk.NextLineIndex = since + len(out)
	return chunk, nil
}

// resolveSubagentPath mirrors the fallback chain in log_tail.go: outputFile
// first, then ~/.claude/projects/.../subagents/agent-<id>.jsonl resolved from
// the outputFile path, then a glob fallback.
func resolveSubagentPath(outputPath, activityID, claudeHomeDir string) (string, string) {
	if outputPath != "" {
		if _, err := os.Stat(outputPath); err == nil {
			return outputPath, "output_file"
		}
	}
	if fallback := resolveClaudeSubagentTranscript(claudeHomeDir, outputPath, activityID); fallback != "" && fallback != outputPath {
		if _, err := os.Stat(fallback); err == nil {
			return fallback, "claude_subagent_transcript"
		}
	}
	if fallback := findClaudeSubagentTranscript(claudeHomeDir, activityID); fallback != "" {
		return fallback, "claude_subagent_transcript"
	}
	return "", ""
}

// readJSONLLines reads the entire file (within chunkByteCap budget for the
// caller to slice) and returns only complete lines (those terminated by \n).
// `since` is unused here for filtering — it is honored by the caller — but we
// pass it so future implementations can stream past it efficiently.
func readJSONLLines(path string, _ int) ([]string, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return nil, 0, err
	}
	size := stat.Size()

	scanner := bufio.NewScanner(file)
	// Allow lines up to 1 MiB; transcripts can have large tool_result blocks.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var lines []string
	var totalBytesScanned int64
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		lines = append(lines, line)
		// Track raw bytes consumed (line + assumed \n) so we can detect a
		// trailing half-line below.
		totalBytesScanned += int64(len(scanner.Bytes())) + 1
	}
	if err := scanner.Err(); err != nil {
		return nil, 0, err
	}

	// If the file does not end with a newline, the last "line" returned by
	// Scanner is incomplete. Drop it so we only expose complete lines.
	if len(lines) > 0 && size > 0 {
		// If totalBytesScanned exceeds size, the last line was unterminated
		// (Scanner counts +1 for an implicit newline that isn't there).
		if totalBytesScanned > size {
			lines = lines[:len(lines)-1]
		}
	}

	return lines, len(lines), nil
}
