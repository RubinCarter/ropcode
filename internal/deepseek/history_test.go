package deepseek

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ropcode/internal/claude"
)

func TestLoadSessionHistoryMergesAdjacentContentEvents(t *testing.T) {
	deepseekDir := t.TempDir()
	sessionID := "deepseek-session-1"
	projectPath := `E:\bit_master\ropcode`
	sessionDir := filepath.Join(deepseekDir, "sessions")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}
	raw := map[string]interface{}{
		"id":        sessionID,
		"workspace": projectPath,
		"items": []interface{}{
			map[string]interface{}{"role": "user", "content": "hi"},
			map[string]interface{}{"type": "content", "content": "早"},
			map[string]interface{}{"type": "content", "content": "。"},
			map[string]interface{}{"type": "content", "content": "有什么"},
			map[string]interface{}{"role": "user", "content": "continue"},
			map[string]interface{}{"type": "content", "content": "需要"},
			map[string]interface{}{"type": "content", "content": "做的"},
			map[string]interface{}{"type": "done"},
		},
	}
	writeJSON(t, filepath.Join(sessionDir, sessionID+".json"), raw)

	messages, err := LoadSessionHistory(deepseekDir, projectPath, sessionID)
	if err != nil {
		t.Fatalf("LoadSessionHistory failed: %v", err)
	}

	if len(messages) != 4 {
		t.Fatalf("expected 4 merged history messages, got %d: %#v", len(messages), messages)
	}
	assertMessageText(t, messages[0], "user", "hi")
	assertMessageText(t, messages[1], "assistant", "早。有什么")
	assertMessageText(t, messages[2], "user", "continue")
	assertMessageText(t, messages[3], "assistant", "需要做的")
}

func TestListProjectSessionsReadsDeepSeekTuiMetadataWorkspace(t *testing.T) {
	deepseekDir := t.TempDir()
	sessionID := "80bf21ec-ceb8-4b44-9457-cbf329b4c5ff"
	projectPath := `E:\Heyang2\LnvAiRecoder\LnvAiRecoderApp`
	sessionDir := filepath.Join(deepseekDir, "sessions")
	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(sessionDir, sessionID+".json"), map[string]interface{}{
		"schema_version": "1.0",
		"metadata": map[string]interface{}{
			"id":         sessionID,
			"title":      "hi? what model",
			"created_at": "2026-05-22T05:43:44.142882900Z",
			"updated_at": "2026-05-22T05:43:55.142882900Z",
			"workspace":  projectPath,
			"model":      "deepseek-v4-flash",
		},
		"messages": []interface{}{
			map[string]interface{}{
				"role": "user",
				"content": []interface{}{
					map[string]interface{}{"type": "text", "text": "<turn_meta>ignore</turn_meta>"},
					map[string]interface{}{"type": "text", "text": "hi? what model"},
				},
			},
			map[string]interface{}{
				"role":    "assistant",
				"content": []interface{}{map[string]interface{}{"type": "text", "text": "DeepSeek"}},
			},
		},
	})

	result, err := ListProjectSessionsLimit(deepseekDir, projectPath, 10)
	if err != nil {
		t.Fatalf("ListProjectSessionsLimit failed: %v", err)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d: %#v", len(result.Sessions), result.Sessions)
	}
	got := result.Sessions[0]
	if got.ID != sessionID || got.ProjectPath != projectPath || got.ProjectID != projectPath {
		t.Fatalf("unexpected session identity: %#v", got)
	}
	if got.FirstMessage != "hi? what model" {
		t.Fatalf("first message = %q, want cleaned user prompt", got.FirstMessage)
	}
	if got.CreatedAt != 1779428624 {
		t.Fatalf("created_at = %d, want created_at unix", got.CreatedAt)
	}
	if got.MessageTimestamp != "2026-05-22T05:43:55Z" {
		t.Fatalf("message timestamp = %q, want updated_at", got.MessageTimestamp)
	}
}

func writeJSON(t *testing.T, path string, value interface{}) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func assertMessageText(t *testing.T, message claude.Message, wantType, wantText string) {
	t.Helper()
	if message.Type != wantType {
		t.Fatalf("message type = %q, want %q: %#v", message.Type, wantType, message)
	}
	content, ok := message.Message["content"].([]map[string]interface{})
	if !ok || len(content) == 0 {
		t.Fatalf("unexpected message content: %#v", message.Message["content"])
	}
	if content[0]["text"] != wantText {
		t.Fatalf("message text = %q, want %q", content[0]["text"], wantText)
	}
}
