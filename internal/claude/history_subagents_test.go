package claude

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSubagentTranscripts(t *testing.T) {
	claudeDir := filepath.Join(t.TempDir(), ".claude")
	projectID := "test-project"
	sessionID := "test-session"
	subagentsDir := GetSubagentSessionDir(claudeDir, projectID, sessionID)
	if err := os.MkdirAll(subagentsDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	alphaContent := `{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","agentId":"alpha","isSidechain":true,"message":{"role":"user","content":"prompt"}}
{"type":"assistant","uuid":"a1","timestamp":"2026-01-01T00:00:01Z","agentId":"alpha","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}
`
	if err := os.WriteFile(filepath.Join(subagentsDir, "agent-alpha.jsonl"), []byte(alphaContent), 0644); err != nil {
		t.Fatalf("WriteFile alpha failed: %v", err)
	}

	betaContent := `{"type":"assistant","uuid":"b1","timestamp":"2026-01-01T00:00:02Z","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"fallback"}]}}
`
	if err := os.WriteFile(filepath.Join(subagentsDir, "agent-beta.jsonl"), []byte(betaContent), 0644); err != nil {
		t.Fatalf("WriteFile beta failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(subagentsDir, "ignored.txt"), []byte(betaContent), 0644); err != nil {
		t.Fatalf("WriteFile ignored failed: %v", err)
	}

	transcripts, err := ReadSubagentTranscripts(claudeDir, projectID, sessionID)
	if err != nil {
		t.Fatalf("ReadSubagentTranscripts failed: %v", err)
	}
	if len(transcripts) != 2 {
		t.Fatalf("expected 2 transcripts, got %d", len(transcripts))
	}
	if got := len(transcripts["alpha"]); got != 2 {
		t.Fatalf("expected 2 alpha messages, got %d", got)
	}
	if got := len(transcripts["beta"]); got != 1 {
		t.Fatalf("expected 1 beta message, got %d", got)
	}
	if transcripts["alpha"][0].AgentID != "alpha" {
		t.Fatalf("expected alpha agent id, got %q", transcripts["alpha"][0].AgentID)
	}
}

func TestReadSubagentTranscriptsFallsBackFromRuntimeSessionID(t *testing.T) {
	claudeDir := filepath.Join(t.TempDir(), ".claude")
	projectID := "test-project"
	runtimeSessionID := "runtime-session"
	claudeSessionID := "claude-session"
	projectDir := filepath.Join(claudeDir, "projects", projectID)
	subagentsDir := GetSubagentSessionDir(claudeDir, projectID, claudeSessionID)
	if err := os.MkdirAll(subagentsDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	parentContent := `{"type":"system","subtype":"init","session_id":"runtime-session","claude_session_id":"claude-session"}
`
	if err := os.WriteFile(filepath.Join(projectDir, claudeSessionID+".jsonl"), []byte(parentContent), 0644); err != nil {
		t.Fatalf("WriteFile parent failed: %v", err)
	}

	transcriptContent := `{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","agentId":"alpha","isSidechain":true,"message":{"role":"user","content":"prompt"}}
`
	if err := os.WriteFile(filepath.Join(subagentsDir, "agent-alpha.jsonl"), []byte(transcriptContent), 0644); err != nil {
		t.Fatalf("WriteFile transcript failed: %v", err)
	}

	transcripts, err := ReadSubagentTranscripts(claudeDir, projectID, runtimeSessionID)
	if err != nil {
		t.Fatalf("ReadSubagentTranscripts failed: %v", err)
	}
	if got := len(transcripts["alpha"]); got != 1 {
		t.Fatalf("expected 1 alpha message, got %d", got)
	}
}

func TestReadSubagentTranscriptsMissingDirectory(t *testing.T) {
	transcripts, err := ReadSubagentTranscripts(filepath.Join(t.TempDir(), ".claude"), "missing-project", "missing-session")
	if err != nil {
		t.Fatalf("ReadSubagentTranscripts failed: %v", err)
	}
	if len(transcripts) != 0 {
		t.Fatalf("expected empty transcripts, got %d", len(transcripts))
	}
}
