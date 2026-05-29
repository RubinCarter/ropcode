package pi

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPiDirHonorsEnvironment(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)

	got, err := PiDir()
	if err != nil {
		t.Fatalf("PiDir returned error: %v", err)
	}
	if got != dir {
		t.Fatalf("PiDir() = %q, want %q", got, dir)
	}
}

func TestListProjectSessionsLimit(t *testing.T) {
	piDir := t.TempDir()
	projectPath := filepath.Join(t.TempDir(), "project")
	sessionDir := filepath.Join(piDir, "sessions", projectDirName(projectPath))
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "20260527_session-1.jsonl")
	writePiHistoryFixture(t, sessionPath)

	result, err := ListProjectSessionsLimit(piDir, projectPath, 10)
	if err != nil {
		t.Fatalf("ListProjectSessionsLimit returned error: %v", err)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(result.Sessions))
	}
	session := result.Sessions[0]
	if session.ID != "session-1" {
		t.Fatalf("session ID = %q, want session-1", session.ID)
	}
	if session.ProjectPath != projectPath {
		t.Fatalf("ProjectPath = %q, want %q", session.ProjectPath, projectPath)
	}
	if session.FirstMessage != "hello pi" {
		t.Fatalf("FirstMessage = %q, want hello pi", session.FirstMessage)
	}
}

func TestLoadSessionHistory(t *testing.T) {
	piDir := t.TempDir()
	projectPath := filepath.Join(t.TempDir(), "project")
	sessionDir := filepath.Join(piDir, "sessions", projectDirName(projectPath))
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "20260527_session-1.jsonl")
	writePiHistoryFixture(t, sessionPath)

	messages, err := LoadSessionHistory(piDir, projectPath, "session-1")
	if err != nil {
		t.Fatalf("LoadSessionHistory returned error: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d: %#v", len(messages), messages)
	}
	if messages[0].Type != "user" || textFromMessage(t, messages[0].Message) != "hello pi" {
		t.Fatalf("first message = %#v, want user hello pi", messages[0])
	}
	if messages[1].Type != "assistant" || textFromMessage(t, messages[1].Message) != "hello from pi" {
		t.Fatalf("second message = %#v, want assistant hello from pi", messages[1])
	}
}

func TestGetMessagesRange(t *testing.T) {
	piDir := t.TempDir()
	projectPath := filepath.Join(t.TempDir(), "project")
	sessionDir := filepath.Join(piDir, "sessions", projectDirName(projectPath))
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "20260527_session-1.jsonl")
	writePiHistoryFixture(t, sessionPath)

	messages, err := GetMessagesRange(piDir, projectPath, "session-1", 2, 2)
	if err != nil {
		t.Fatalf("GetMessagesRange returned error: %v", err)
	}
	if len(messages) != 1 || messages[0].Type != "assistant" {
		t.Fatalf("range messages = %#v, want one assistant", messages)
	}
}

func writePiHistoryFixture(t *testing.T, path string) {
	t.Helper()
	lines := `{"id":"req-1","type":"prompt","message":"hello pi","timestamp":"2026-05-27T01:02:03Z"}` + "\n" +
		`{"id":"pi-1","type":"response","command":"prompt","success":true,"data":{"sessionId":"session-1","sessionFile":"` + filepath.ToSlash(path) + `"},"timestamp":"2026-05-27T01:02:04Z"}` + "\n" +
		`{"type":"message_update","delta":"hello from pi","timestamp":"2026-05-27T01:02:05Z"}` + "\n" +
		`{"type":"agent_end","success":true,"timestamp":"2026-05-27T01:02:06Z"}` + "\n"
	if err := os.WriteFile(path, []byte(lines), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	modTime := time.Date(2026, 5, 27, 1, 2, 6, 0, time.UTC)
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatalf("Chtimes failed: %v", err)
	}
}

func textFromMessage(t *testing.T, msg map[string]interface{}) string {
	t.Helper()
	content, ok := msg["content"].([]map[string]interface{})
	if !ok || len(content) == 0 {
		t.Fatalf("missing text content: %#v", msg)
	}
	text, _ := content[0]["text"].(string)
	return text
}
