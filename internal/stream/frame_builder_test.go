package stream

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ropcode/internal/provider"
)

func TestClaudeAdapterConvertsMessageContentAndUsage(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role": "assistant",
				"content": []any{
					map[string]any{"type": "text", "text": "hello"},
					map[string]any{"type": "thinking", "thinking": "plan"},
					map[string]any{"type": "tool_use", "id": "toolu_1", "name": "Read", "input": map[string]any{"file_path": "README.md"}},
				},
				"usage": map[string]any{"input_tokens": 10, "output_tokens": 2, "cache_read_input_tokens": 3},
			},
			"uuid": "raw-kept",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Role != RoleAssistant {
		t.Fatalf("expected assistant role, got %q", frame.Role)
	}
	if len(frame.Content) != 3 {
		t.Fatalf("expected 3 content blocks, got %#v", frame.Content)
	}
	if frame.Content[0].Type != ContentText || frame.Content[0].Text != "hello" {
		t.Fatalf("unexpected text block: %#v", frame.Content[0])
	}
	if frame.Content[1].Type != ContentThinking || frame.Content[1].Text != "plan" {
		t.Fatalf("unexpected thinking block: %#v", frame.Content[1])
	}
	if frame.Content[2].Type != ContentToolUse || frame.Content[2].ToolUseID != "toolu_1" || frame.Content[2].Name != "Read" {
		t.Fatalf("unexpected tool use block: %#v", frame.Content[2])
	}
	if frame.Usage.InputTokens != 10 || frame.Usage.OutputTokens != 2 || frame.Usage.CacheReadTokens != 3 {
		t.Fatalf("unexpected usage: %#v", frame.Usage)
	}
	if frame.Meta.Raw["uuid"] != "raw-kept" {
		t.Fatalf("expected raw uuid in meta: %#v", frame.Meta.Raw)
	}
}

func TestClaudeAdapterPreservesSubagentLifecycleFields(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "task_progress",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type":           "system",
			"subtype":        "task_progress",
			"task_id":        "task-1",
			"tool_use_id":    "toolu_parent",
			"description":    "Reading file",
			"last_tool_name": "Read",
			"usage":          map[string]any{"total_tokens": 30, "tool_uses": 1, "duration_ms": 400},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.TaskID != "task-1" || frame.ToolUseID != "toolu_parent" || frame.AgentID != "task-1" {
		t.Fatalf("unexpected task identity: %#v", frame)
	}
	if !frame.Sidechain {
		t.Fatal("task progress should be treated as sidechain activity")
	}
	if frame.Runtime == nil || frame.Runtime.ActiveTool != "Read" || frame.Runtime.ProgressText != "Reading file" {
		t.Fatalf("unexpected runtime snapshot: %#v", frame.Runtime)
	}
	if frame.Usage.TotalTokens != 30 || frame.Usage.ToolUseCount != 1 || frame.DurationMs != 400 {
		t.Fatalf("unexpected usage/duration: usage=%#v duration=%d", frame.Usage, frame.DurationMs)
	}
}

func TestClaudeAdapterConvertsToolResultAndToolUseResult(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "tool_result", "tool_use_id": "toolu_parent", "content": "done"},
				},
			},
			"tool_use_result": map[string]any{
				"agentId":           "agent-1",
				"status":            "completed",
				"totalDurationMs":   1200,
				"totalTokens":       42,
				"totalToolUseCount": 2,
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Role != RoleUser {
		t.Fatalf("expected user role, got %q", frame.Role)
	}
	if frame.Content[0].Type != ContentToolResult || frame.Content[0].ToolUseID != "toolu_parent" || frame.Content[0].Text != "done" {
		t.Fatalf("unexpected tool result block: %#v", frame.Content[0])
	}
	if frame.AgentID != "agent-1" || frame.DurationMs != 1200 || frame.Usage.TotalTokens != 42 || frame.Usage.ToolUseCount != 2 {
		t.Fatalf("unexpected tool use result mapping: %#v", frame)
	}
}

func TestClaudeAdapterHandlesRealSubagentFixture(t *testing.T) {
	path := filepath.Join("..", "..", "frontend", "src", "lib", "__fixtures__", "claude-real-subagent-stream.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	var sawTaskUse, sawSidechain, sawToolResult, sawResult bool
	for i, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			t.Fatalf("line %d: %v", i+1, err)
		}
		event := provider.OutputEvent{
			Type:      stringFromMap(msg, "type"),
			Subtype:   stringFromMap(msg, "subtype"),
			SessionID: stringFromMap(msg, "session_id"),
			Provider:  "claude",
			Message:   msg,
		}
		frame, err := AdaptClaudeOutput(ProviderOutputContext{}, event, int64(i+1))
		if err != nil {
			t.Fatalf("line %d: %v", i+1, err)
		}
		for _, block := range frame.Content {
			if block.Type == ContentToolUse && block.Name == "Agent" {
				sawTaskUse = true
			}
			if block.Type == ContentToolResult {
				sawToolResult = true
			}
		}
		if frame.ParentToolUseID != "" {
			sawSidechain = true
		}
		if frame.Kind == FrameKindResult && frame.Success != nil && *frame.Success {
			sawResult = true
		}
	}

	if !sawTaskUse || !sawSidechain || !sawToolResult || !sawResult {
		t.Fatalf("fixture coverage missing: taskUse=%t sidechain=%t toolResult=%t result=%t", sawTaskUse, sawSidechain, sawToolResult, sawResult)
	}
}
