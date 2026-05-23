package stream

import (
	"testing"

	"ropcode/internal/provider"
)

func TestCodexAdapterConvertsThreadStartedToInit(t *testing.T) {
	frame, err := AdaptCodexOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "init",
		SessionID: "runtime-1",
		Provider:  "codex",
		Message: map[string]any{
			"type":      "thread.started",
			"thread_id": "thread-1",
			"cwd":       "E:/repo",
			"timestamp": "2026-05-23T08:00:00Z",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindInit || frame.ProviderSessionID != "thread-1" || frame.Cwd != "E:/repo" {
		t.Fatalf("unexpected init frame: %#v", frame)
	}
}

func TestCodexAdapterConvertsMessagesReasoningAndTools(t *testing.T) {
	cases := []struct {
		name  string
		event provider.OutputEvent
		want  ContentBlock
		role  Role
		kind  FrameKind
	}{
		{
			name: "assistant message",
			event: provider.OutputEvent{
				Type:      "assistant",
				SessionID: "runtime-1",
				Provider:  "codex",
				Message: map[string]any{
					"type": "response_item",
					"payload": map[string]any{
						"type": "message",
						"role": "assistant",
						"content": []any{
							map[string]any{"type": "output_text", "text": "hello"},
						},
					},
				},
			},
			want: ContentBlock{Type: ContentText, Text: "hello"},
			role: RoleAssistant,
			kind: FrameKindMessage,
		},
		{
			name: "reasoning",
			event: provider.OutputEvent{
				Type:      "assistant",
				Subtype:   "reasoning",
				SessionID: "runtime-1",
				Provider:  "codex",
				Message: map[string]any{
					"type": "response_item",
					"payload": map[string]any{
						"type":    "reasoning",
						"summary": []any{map[string]any{"text": "thinking"}},
					},
				},
			},
			want: ContentBlock{Type: ContentThinking, Text: "thinking"},
			role: RoleAssistant,
			kind: FrameKindMessage,
		},
		{
			name: "function call",
			event: provider.OutputEvent{
				Type:      "tool_use",
				SessionID: "runtime-1",
				Provider:  "codex",
				Message: map[string]any{
					"type": "response_item",
					"payload": map[string]any{
						"type":      "function_call",
						"call_id":   "call-1",
						"name":      "shell",
						"arguments": map[string]any{"cmd": "go test"},
					},
				},
			},
			want: ContentBlock{Type: ContentToolUse, ToolUseID: "call-1", Name: "shell"},
			role: RoleAssistant,
			kind: FrameKindTool,
		},
		{
			name: "function output",
			event: provider.OutputEvent{
				Type:      "tool_result",
				SessionID: "runtime-1",
				Provider:  "codex",
				Message: map[string]any{
					"type": "response_item",
					"payload": map[string]any{
						"type":    "function_call_output",
						"call_id": "call-1",
						"output":  "ok",
					},
				},
			},
			want: ContentBlock{Type: ContentToolResult, ToolUseID: "call-1", Text: "ok"},
			role: RoleTool,
			kind: FrameKindTool,
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			frame, err := AdaptCodexOutput(ProviderOutputContext{}, tc.event, int64(i+1))
			if err != nil {
				t.Fatal(err)
			}
			if frame.Role != tc.role || frame.Kind != tc.kind {
				t.Fatalf("unexpected role/kind: %#v", frame)
			}
			if len(frame.Content) != 1 {
				t.Fatalf("expected one content block, got %#v", frame.Content)
			}
			got := frame.Content[0]
			if got.Type != tc.want.Type || got.Text != tc.want.Text || got.ToolUseID != tc.want.ToolUseID || got.Name != tc.want.Name {
				t.Fatalf("unexpected content block: %#v", got)
			}
		})
	}
}

func TestCodexAdapterConvertsCompletionToResult(t *testing.T) {
	frame, err := AdaptCodexOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "session_complete",
		SessionID: "runtime-1",
		Provider:  "codex",
		Message: map[string]any{
			"type":      "thread.completed",
			"thread_id": "thread-1",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindResult || frame.Success == nil || !*frame.Success {
		t.Fatalf("unexpected result frame: %#v", frame)
	}
}
