package claudeactivity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupAgentBucket(t *testing.T, outputPath string) *Service {
	t.Helper()
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)

	bucket := service.buckets["runtime-1"]
	now := time.Now().UTC()
	started := now
	bucket.activities["agent-1"] = &Activity{
		ID:         "agent-1",
		TaskType:   "local_agent",
		Type:       ActivityTypeLocalAgent,
		Status:     ActivityStatusRunning,
		StartedAt:  &started,
		UpdatedAt:  now,
		OutputFile: outputPath,
	}
	bucket.order = append(bucket.order, "agent-1")
	return service
}

func writeJSONL(t *testing.T, path string, lineCount int) {
	t.Helper()
	var b strings.Builder
	for i := 0; i < lineCount; i++ {
		b.WriteString(`{"line":`)
		b.WriteString(itoa(i))
		b.WriteString("}\n")
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	var digits [20]byte
	pos := len(digits)
	for i > 0 {
		pos--
		digits[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		digits[pos] = '-'
	}
	return string(digits[pos:])
}

func TestReadSubagentLogShortFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	writeJSONL(t, path, 5)

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if chunk.TotalLines != 5 || len(chunk.Lines) != 5 {
		t.Fatalf("expected 5 lines, got total=%d len=%d", chunk.TotalLines, len(chunk.Lines))
	}
	if chunk.TruncatedBefore != 0 {
		t.Fatalf("expected truncated_before=0, got %d", chunk.TruncatedBefore)
	}
	if chunk.NextLineIndex != 5 {
		t.Fatalf("expected next_line_index=5, got %d", chunk.NextLineIndex)
	}
	if chunk.FileMissing {
		t.Fatal("did not expect file_missing")
	}
}

func TestReadSubagentLogLongFileInitial(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	writeJSONL(t, path, 500)

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if chunk.TotalLines != 500 {
		t.Fatalf("expected total_lines=500, got %d", chunk.TotalLines)
	}
	if len(chunk.Lines) != 80 {
		t.Fatalf("expected 80 lines, got %d", len(chunk.Lines))
	}
	if chunk.TruncatedBefore != 420 {
		t.Fatalf("expected truncated_before=420, got %d", chunk.TruncatedBefore)
	}
	if chunk.NextLineIndex != 500 {
		t.Fatalf("expected next_line_index=500, got %d", chunk.NextLineIndex)
	}
	if chunk.Lines[0] != `{"line":420}` {
		t.Fatalf("expected first line to be line 420, got %q", chunk.Lines[0])
	}
}

func TestReadSubagentLogIncrementalCappedAt80(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	writeJSONL(t, path, 500)

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", 400)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunk.Lines) != 80 {
		t.Fatalf("expected 80 lines, got %d", len(chunk.Lines))
	}
	if chunk.NextLineIndex != 480 {
		t.Fatalf("expected next_line_index=480, got %d", chunk.NextLineIndex)
	}
	if chunk.Lines[0] != `{"line":400}` {
		t.Fatalf("expected first line to be line 400, got %q", chunk.Lines[0])
	}
}

func TestReadSubagentLogHalfLineExcluded(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	// Three complete lines plus a final line without trailing newline.
	content := "{\"line\":0}\n{\"line\":1}\n{\"line\":2}\n{\"partial\""
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if chunk.TotalLines != 3 {
		t.Fatalf("expected total_lines=3 (half-line excluded), got %d", chunk.TotalLines)
	}
	if len(chunk.Lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(chunk.Lines))
	}
}

func TestReadSubagentLogSinceBeyondTotal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	writeJSONL(t, path, 10)

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if !chunk.FileMissing {
		t.Fatal("expected file_missing=true when since > total_lines")
	}
}

func TestReadSubagentLogFileNotExists(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "nope.jsonl")

	service := setupAgentBucket(t, missing)
	// Disable the global fallback so we don't accidentally find a real
	// transcript on the developer's machine.
	service.claudeHomeDir = filepath.Join(dir, "no-claude-home")

	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if !chunk.FileMissing {
		t.Fatal("expected file_missing=true when file does not exist")
	}
	if len(chunk.Lines) != 0 {
		t.Fatalf("expected no lines, got %d", len(chunk.Lines))
	}
}

func TestReadSubagentLogCRLF(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	content := "{\"line\":0}\r\n{\"line\":1}\r\n{\"line\":2}\r\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if chunk.TotalLines != 3 {
		t.Fatalf("expected 3 lines, got %d", chunk.TotalLines)
	}
	for i, line := range chunk.Lines {
		if strings.HasSuffix(line, "\r") {
			t.Fatalf("line %d still has trailing \\r: %q", i, line)
		}
	}
}

func TestReadSubagentLogFallbackToClaudeHome(t *testing.T) {
	dir := t.TempDir()
	homeDir := filepath.Join(dir, "claude-home")
	// outputFile location encodes project slug + claude session ID, mirroring
	// the layout parseClaudeOutputPath expects: .../claude/<slug>/<session>/tasks/...
	outputPath := filepath.Join(dir, "claude", "myproj", "abc123", "tasks", "agent.txt")
	subagentDir := filepath.Join(homeDir, "projects", "myproj", "abc123", "subagents")
	if err := os.MkdirAll(subagentDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(subagentDir, "agent-agent-1.jsonl")
	writeJSONL(t, transcriptPath, 3)

	service := setupAgentBucket(t, outputPath)
	service.claudeHomeDir = homeDir

	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", -1)
	if err != nil {
		t.Fatal(err)
	}
	if chunk.ResolvedBy != "claude_subagent_transcript" {
		t.Fatalf("expected resolved_by=claude_subagent_transcript, got %q", chunk.ResolvedBy)
	}
	if chunk.TotalLines != 3 {
		t.Fatalf("expected 3 lines, got %d", chunk.TotalLines)
	}
}

func TestReadSubagentLogRejectsNonAgentActivity(t *testing.T) {
	service := NewService()
	service.EnsureSession("runtime-1", "E:\\repo", true, nil)
	bucket := service.buckets["runtime-1"]
	now := time.Now().UTC()
	bucket.activities["bash-1"] = &Activity{
		ID:        "bash-1",
		TaskType:  "local_bash",
		Type:      ActivityTypeLocalBash,
		Status:    ActivityStatusRunning,
		UpdatedAt: now,
	}
	bucket.order = append(bucket.order, "bash-1")

	if _, err := service.ReadSubagentLog("runtime-1", "bash-1", -1); err == nil {
		t.Fatal("expected error for non-local_agent activity")
	}
}

func TestReadSubagentLogIncrementalAtTotal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.jsonl")
	writeJSONL(t, path, 10)

	service := setupAgentBucket(t, path)
	chunk, err := service.ReadSubagentLog("runtime-1", "agent-1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(chunk.Lines) != 0 {
		t.Fatalf("expected 0 new lines when since == total_lines, got %d", len(chunk.Lines))
	}
	if chunk.NextLineIndex != 10 {
		t.Fatalf("expected next_line_index=10, got %d", chunk.NextLineIndex)
	}
	if chunk.FileMissing {
		t.Fatal("did not expect file_missing")
	}
}
