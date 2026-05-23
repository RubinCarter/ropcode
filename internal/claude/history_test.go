package claude

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ropcode/internal/stream"
)

func TestExtractClaudeSessionInfoDoesNotReadPastPreviewWindowForTitle(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "session.jsonl")
	var builder strings.Builder
	for i := 0; i < 55; i++ {
		builder.WriteString(fmt.Sprintf(`{"timestamp":"2026-05-18T06:00:%02dZ","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"working"}]}}`, i%60))
		builder.WriteByte('\n')
	}
	builder.WriteString(`{"timestamp":"2026-05-18T06:01:00Z","type":"user","message":{"role":"user","content":"late title should not be read"}}`)
	builder.WriteByte('\n')

	if err := os.WriteFile(filePath, []byte(builder.String()), 0644); err != nil {
		t.Fatal(err)
	}

	info, err := extractClaudeSessionInfo(filePath, "session", "project", `E:\bit_master\ropcode`)
	if err != nil {
		t.Fatal(err)
	}
	if info.FirstMessage != "" {
		t.Fatalf("first message = %q, want empty title preview after scan limit", info.FirstMessage)
	}
}

func TestGetProjectHashNormalizesWindowsPathsForClaudeProjectDirs(t *testing.T) {
	got := GetProjectHash(`E:\bit_master\ropcode`)
	want := "E--bit-master-ropcode"
	if got != want {
		t.Fatalf("GetProjectHash() = %q, want %q", got, want)
	}
}

func TestLoadSessionHistoryFramesPreservesClaudeShape(t *testing.T) {
	claudeDir := t.TempDir()
	projectPath := `E:\bit_master\ropcode`
	projectID := GetProjectHash(projectPath)
	sessionID := "claude-history-frames"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(projectDir, sessionID+".jsonl")
	content := `{"type":"assistant","sessionId":"provider-1","cwd":"` + strings.ReplaceAll(projectPath, `\`, `\\`) + `","timestamp":"2026-05-23T08:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}
`
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	frames, err := LoadSessionHistoryFrames(claudeDir, projectID, sessionID, projectPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 1 {
		t.Fatalf("got %d frames, want 1", len(frames))
	}
	if frames[0].Provider != "claude" || frames[0].StreamID != stream.StreamIDForSession("claude", sessionID) {
		t.Fatalf("unexpected identity: %#v", frames[0])
	}
	if frames[0].ProviderSessionID != "provider-1" {
		t.Fatalf("provider session id = %q", frames[0].ProviderSessionID)
	}
	if frames[0].Content[0].Text != "hello" {
		t.Fatalf("unexpected content: %#v", frames[0].Content)
	}
}
