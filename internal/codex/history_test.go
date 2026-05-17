package codex

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListProjectSessionsReadsSessionMetaPayload(t *testing.T) {
	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "17")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectPath := filepath.Join("E:", "bit_master", "ropcode")
	sessionID := "019e3619-7b99-70e3-8264-348f8e5a10a4"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-17T21-21-40-"+sessionID+".jsonl")
	content := `{"timestamp":"2026-05-17T13:21:50.490Z","type":"session_meta","payload":{"id":"019e3619-7b99-70e3-8264-348f8e5a10a4","timestamp":"2026-05-17T13:21:40.249Z","cwd":"` + escapeWindowsPath(projectPath) + `","originator":"Codex Desktop"}}
{"timestamp":"2026-05-17T13:22:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
`
	if err := os.WriteFile(sessionPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	sessions, err := ListProjectSessions(codexDir, projectPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("got %d sessions, want 1", len(sessions))
	}
	if sessions[0].ID != sessionID {
		t.Fatalf("session ID = %q, want %q", sessions[0].ID, sessionID)
	}
	if sessions[0].ProjectPath != projectPath {
		t.Fatalf("project path = %q, want %q", sessions[0].ProjectPath, projectPath)
	}
	if sessions[0].CreatedAt == 0 {
		t.Fatal("expected CreatedAt from session metadata timestamp")
	}
	if sessions[0].MessageTimestamp != "2026-05-17T13:22:00.000Z" {
		t.Fatalf("message timestamp = %q", sessions[0].MessageTimestamp)
	}
}

func TestListProjectSessionsIgnoresLegacyThreadStartedRecords(t *testing.T) {
	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "17")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectPath := filepath.Join("E:", "bit_master", "ropcode")
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-17T21-21-40-legacy-session.jsonl")
	content := `{"timestamp":"2026-05-17T13:21:40.249Z","type":"thread.started","thread_id":"legacy-session","cwd":"` + escapeWindowsPath(projectPath) + `"}
{"timestamp":"2026-05-17T13:22:00.000Z","type":"response_item","cwd":"` + escapeWindowsPath(projectPath) + `","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
`
	if err := os.WriteFile(sessionPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	sessions, err := ListProjectSessions(codexDir, projectPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 0 {
		t.Fatalf("got %d sessions, want 0", len(sessions))
	}
}

func escapeWindowsPath(path string) string {
	escaped := ""
	for _, ch := range path {
		if ch == '\\' {
			escaped += `\\`
		} else {
			escaped += string(ch)
		}
	}
	return escaped
}
