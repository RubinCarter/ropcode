package codex

import (
	"os"
	"path/filepath"
	"testing"
	"time"
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
	if sessions[0].FirstMessage != "hello" {
		t.Fatalf("first message = %q, want hello", sessions[0].FirstMessage)
	}
}

func TestListProjectSessionsSkipsInjectedUserContextForFirstMessage(t *testing.T) {
	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "18")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectPath := filepath.Join("E:", "bit_master", "ropcode")
	sessionID := "019e3b37-10f0-70cf-a56f-7fb96a6a1b2d"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-18T14-00-00-"+sessionID+".jsonl")
	content := `{"timestamp":"2026-05-18T06:00:00.000Z","type":"session_meta","payload":{"id":"` + sessionID + `","timestamp":"2026-05-18T06:00:00.000Z","cwd":"` + escapeWindowsPath(projectPath) + `","originator":"Codex Desktop"}}
{"timestamp":"2026-05-18T06:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for E:\\bit_master\\ropcode\n\n<INSTRUCTIONS>\nRepo-specific agent instructions that must not become a session title.\n</INSTRUCTIONS>"}]}}
{"timestamp":"2026-05-18T06:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>E:\\bit_master\\ropcode</cwd>\n</environment_context>"}]}}
{"timestamp":"2026-05-18T06:00:03.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"修复会话标题"}]}}
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
	if sessions[0].FirstMessage != "修复会话标题" {
		t.Fatalf("first message = %q, want real user prompt", sessions[0].FirstMessage)
	}
}

func TestListProjectSessionsDoesNotReadPastPreviewWindowForFirstMessage(t *testing.T) {
	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "18")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectPath := filepath.Join("E:", "bit_master", "ropcode")
	sessionID := "late-title-window"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-18T14-10-00-"+sessionID+".jsonl")
	content := `{"timestamp":"2026-05-18T06:10:00.000Z","type":"session_meta","payload":{"id":"` + sessionID + `","timestamp":"2026-05-18T06:10:00.000Z","cwd":"` + escapeWindowsPath(projectPath) + `","originator":"Codex Desktop"}}
`
	const previewWindow = 20
	for i := 0; i < previewWindow; i++ {
		content += `{"timestamp":"2026-05-18T06:10:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"working"}]}}
`
	}
	content += `{"timestamp":"2026-05-18T06:10:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"late title should not be read"}]}}
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
	if sessions[0].FirstMessage != "" {
		t.Fatalf("first message = %q, want empty title preview after scan limit", sessions[0].FirstMessage)
	}
}

func TestListProjectSessionsMatchesWindowsPathCaseInsensitively(t *testing.T) {
	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "18")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	storedProjectPath := `e:\bit_master\ropcode`
	targetProjectPath := `E:\bit_master\ropcode`
	sessionID := "case-insensitive-path"
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-18T15-00-00-"+sessionID+".jsonl")
	content := `{"timestamp":"2026-05-18T07:00:00.000Z","type":"session_meta","payload":{"id":"` + sessionID + `","timestamp":"2026-05-18T07:00:00.000Z","cwd":"` + escapeWindowsPath(storedProjectPath) + `","originator":"Codex Desktop"}}
{"timestamp":"2026-05-18T07:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
`
	if err := os.WriteFile(sessionPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	sessions, err := ListProjectSessions(codexDir, targetProjectPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 {
		t.Fatalf("got %d sessions, want 1", len(sessions))
	}
}

func TestListProjectSessionsLimitStopsAfterRecentScanBudget(t *testing.T) {
	oldBudget := maxLimitedProjectSessionScanFiles
	maxLimitedProjectSessionScanFiles = 2
	t.Cleanup(func() {
		maxLimitedProjectSessionScanFiles = oldBudget
	})

	codexDir := t.TempDir()
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "05", "18")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}

	targetProject := filepath.Join("E:", "bit_master", "ropcode")
	otherProject := filepath.Join("E:", "other")
	files := []struct {
		id      string
		project string
		modTime int64
	}{
		{"recent-other-1", otherProject, 300},
		{"recent-other-2", otherProject, 200},
		{"old-target", targetProject, 100},
	}
	for i, file := range files {
		path := filepath.Join(sessionDir, "rollout-2026-05-18T14-00-0"+string(rune('0'+i))+"-"+file.id+".jsonl")
		content := `{"timestamp":"2026-05-18T06:00:00.000Z","type":"session_meta","payload":{"id":"` + file.id + `","timestamp":"2026-05-18T06:00:00.000Z","cwd":"` + escapeWindowsPath(file.project) + `","originator":"Codex Desktop"}}
{"timestamp":"2026-05-18T06:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}
`
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		modTime := time.Unix(file.modTime, 0)
		if err := os.Chtimes(path, modTime, modTime); err != nil {
			t.Fatal(err)
		}
	}

	result, err := ListProjectSessionsLimit(codexDir, targetProject, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Sessions) != 0 {
		t.Fatalf("got %d sessions after scan budget, want 0", len(result.Sessions))
	}
	if !result.HasMore {
		t.Fatal("expected HasMore when limited scan budget stops before all files")
	}

	result, err = ListProjectSessionsLimit(codexDir, targetProject, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Sessions) != 1 || result.Sessions[0].ID != "old-target" {
		t.Fatalf("full scan sessions = %#v, want old-target", result.Sessions)
	}
	if result.HasMore {
		t.Fatal("expected full scan HasMore false")
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
