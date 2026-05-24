package stream

import (
	"testing"

	_ "ropcode/internal/provider/claude"
	_ "ropcode/internal/provider/codex"
	_ "ropcode/internal/provider/deepseek"
)

func TestAdaptClaudeHistoryEntryUsesClaudeOutputAdapter(t *testing.T) {
	frame, err := AdaptClaudeHistoryEntry(ProviderOutputContext{
		RuntimeSessionID: "runtime-1",
		ProjectPath:      "E:/repo",
	}, map[string]any{
		"type":      "assistant",
		"sessionId": "provider-1",
		"cwd":       "E:/repo",
		"timestamp": "2026-05-23T08:00:00Z",
		"message": map[string]any{
			"role": "assistant",
			"content": []any{
				map[string]any{"type": "text", "text": "hello from history"},
			},
		},
		"debug_meta": map[string]any{"runtime_state": "responding"},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Provider != "claude" || frame.RuntimeSessionID != "runtime-1" || frame.ProviderSessionID != "provider-1" {
		t.Fatalf("unexpected identity: %#v", frame)
	}
	if frame.StreamID == StreamIDForSession("claude", "provider-1") {
		t.Fatalf("provider session id must not be used as stream route: %#v", frame)
	}
	if frame.Kind != FrameKindMessage || frame.Role != RoleAssistant {
		t.Fatalf("unexpected kind/role: %#v", frame)
	}
	if len(frame.Content) != 1 || frame.Content[0].Type != ContentText || frame.Content[0].Text != "hello from history" {
		t.Fatalf("unexpected content: %#v", frame.Content)
	}
	if frame.Runtime == nil || frame.Runtime.Phase != "responding" {
		t.Fatalf("expected normalized runtime state: %#v", frame.Runtime)
	}
	if frame.Meta.Raw["debug_meta"] == nil {
		t.Fatalf("expected raw history fragment in meta: %#v", frame.Meta.Raw)
	}
}

func TestAdaptCodexHistoryEventUsesCodexOutputAdapter(t *testing.T) {
	frame, err := AdaptCodexHistoryEvent(ProviderOutputContext{
		RuntimeSessionID: "runtime-1",
		ProjectPath:      "E:/repo",
	}, map[string]any{
		"type":      "response_item",
		"timestamp": "2026-05-23T08:00:00Z",
		"payload": map[string]any{
			"type":    "reasoning",
			"summary": []any{map[string]any{"text": "thinking from history"}},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Provider != "codex" || frame.StreamID != StreamIDForSession("codex", "runtime-1") {
		t.Fatalf("unexpected identity: %#v", frame)
	}
	if frame.Kind != FrameKindMessage || frame.Role != RoleAssistant {
		t.Fatalf("unexpected kind/role: %#v", frame)
	}
	if len(frame.Content) != 1 || frame.Content[0].Type != ContentThinking || frame.Content[0].Text != "thinking from history" {
		t.Fatalf("unexpected content: %#v", frame.Content)
	}
	if frame.Meta.Raw["message"] == nil {
		t.Fatalf("expected normalized message in meta: %#v", frame.Meta.Raw)
	}
}

func TestAdaptDeepSeekHistoryDocumentRecoversToolsAndPreservesRaw(t *testing.T) {
	frames, err := AdaptDeepSeekHistoryDocument(ProviderOutputContext{
		RuntimeSessionID: "runtime-1",
		ProjectPath:      "E:/repo",
	}, map[string]any{
		"id":        "provider-1",
		"workspace": "E:/repo",
		"messages": []any{
			map[string]any{"role": "assistant", "type": "content", "content": "hello"},
			map[string]any{"type": "tool_use", "id": "tool-1", "name": "exec_shell", "input": map[string]any{"command": "go test ./..."}},
			map[string]any{"type": "tool_result", "id": "tool-1", "output": "ok"},
			map[string]any{"role": "assistant", "content": []any{map[string]any{"text": "raw-only text"}}},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if len(frames) != 4 {
		t.Fatalf("expected 4 frames, got %d: %#v", len(frames), frames)
	}
	if frames[0].ProviderSessionID != "provider-1" || frames[0].StreamID != StreamIDForSession("deepseek", "runtime-1") {
		t.Fatalf("unexpected identity: %#v", frames[0])
	}
	if frames[1].Content[0].Type != ContentToolUse || frames[1].Content[0].Name != "Bash" {
		t.Fatalf("expected recovered tool use, got %#v", frames[1])
	}
	if frames[2].Content[0].Type != ContentToolResult || frames[2].Content[0].ToolUseID != "tool-1" {
		t.Fatalf("expected recovered tool result, got %#v", frames[2])
	}
	if frames[3].Content[0].Type != ContentText || frames[3].Content[0].Text != "raw-only text" {
		t.Fatalf("expected fallback text frame, got %#v", frames[3])
	}
	if frames[3].Meta.Raw["message"] == nil {
		t.Fatalf("expected normalized message in meta: %#v", frames[3].Meta.Raw)
	}
}
