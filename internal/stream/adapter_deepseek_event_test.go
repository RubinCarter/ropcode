package stream

import (
	"testing"

	"ropcode/internal/provider"
)

func TestDeepSeekAdapterConvertsContentDelta(t *testing.T) {
	frame, err := AdaptDeepSeekOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message: map[string]any{
			"type":    "content",
			"content": "hello",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindDelta || frame.Role != RoleAssistant {
		t.Fatalf("unexpected delta frame: %#v", frame)
	}
	if len(frame.Content) != 1 || frame.Content[0].Type != ContentText || frame.Content[0].Text != "hello" {
		t.Fatalf("unexpected content: %#v", frame.Content)
	}
}

func TestDeepSeekAdapterConvertsToolUseAndResult(t *testing.T) {
	toolFrame, err := AdaptDeepSeekOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "tool_use",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message: map[string]any{
			"type":  "tool_use",
			"id":    "tool-1",
			"name":  "exec_shell",
			"input": map[string]any{"command": "go test ./..."},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if toolFrame.Content[0].Type != ContentToolUse || toolFrame.Content[0].ToolUseID != "tool-1" || toolFrame.Content[0].Name != "Bash" {
		t.Fatalf("unexpected tool use: %#v", toolFrame.Content[0])
	}
	if toolFrame.Content[0].Input["command"] != "go test ./..." {
		t.Fatalf("unexpected tool input: %#v", toolFrame.Content[0].Input)
	}

	resultFrame, err := AdaptDeepSeekOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "tool_result",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message: map[string]any{
			"type":   "tool_result",
			"id":     "tool-1",
			"output": "ok",
			"status": "error",
		},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}

	if resultFrame.Role != RoleTool || resultFrame.Content[0].Type != ContentToolResult || resultFrame.Content[0].ToolUseID != "tool-1" || !resultFrame.Content[0].IsError {
		t.Fatalf("unexpected tool result: %#v", resultFrame)
	}
}

func TestDeepSeekAdapterPreservesRuntimeAndProviderSessionIDs(t *testing.T) {
	frame, err := AdaptDeepSeekOutput(ProviderOutputContext{RuntimeSessionID: "runtime-1"}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "session_capture",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message: map[string]any{
			"type":    "session_capture",
			"content": "provider-1",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindInit || frame.RuntimeSessionID != "runtime-1" || frame.ProviderSessionID != "provider-1" {
		t.Fatalf("unexpected session ids: %#v", frame)
	}
}

func TestDeepSeekAdapterConvertsMetadataAndDone(t *testing.T) {
	metaFrame, err := AdaptDeepSeekOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "metadata",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message: map[string]any{
			"type": "metadata",
			"meta": map[string]any{"session_id": "provider-1", "total_tokens": 12},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if metaFrame.Kind != FrameKindMetadata || metaFrame.ProviderSessionID != "provider-1" || metaFrame.Usage.TotalTokens != 12 {
		t.Fatalf("unexpected metadata frame: %#v", metaFrame)
	}

	doneFrame, err := AdaptDeepSeekOutput(ProviderOutputContext{ProviderSessionID: "provider-1"}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "session_complete",
		SessionID: "runtime-1",
		Provider:  "deepseek",
		Message:   map[string]any{"type": "done"},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if doneFrame.Kind != FrameKindResult || doneFrame.Success == nil || !*doneFrame.Success || doneFrame.ProviderSessionID != "provider-1" {
		t.Fatalf("unexpected done frame: %#v", doneFrame)
	}
}
