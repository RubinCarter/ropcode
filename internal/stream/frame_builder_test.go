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

func TestClaudeAdapterMarksSidechainJsonlEntriesAsSidechain(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type":        "assistant",
			"isSidechain": true,
			"agentId":     "agent-1",
			"message": map[string]any{
				"role": "assistant",
				"content": []any{
					map[string]any{"type": "tool_use", "id": "toolu_1", "name": "WebSearch", "input": map[string]any{"query": "深圳天气"}},
				},
			},
			"debug_meta": map[string]any{
				"runtime_state": map[string]any{
					"phase":       "tool_running",
					"active_tool": "WebSearch",
				},
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if !frame.Sidechain {
		t.Fatalf("isSidechain JSONL entries must be marked sidechain: %#v", frame)
	}
	if frame.AgentID != "agent-1" {
		t.Fatalf("expected agent id to be preserved, got %q", frame.AgentID)
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

func TestCodexAdapterPreservesSubagentTaskAndResultIdentity(t *testing.T) {
	task, err := AdaptCodexOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "system",
		Subtype:   "task_started",
		SessionID: "runtime-1",
		Provider:  "codex",
		Message: map[string]any{
			"type":        "system",
			"subtype":     "task_started",
			"task_id":     "sub-thread-1",
			"tool_use_id": "call_spawn",
			"description": "run echo",
			"task_type":   "local_agent",
			"prompt":      "run echo",
			"agentId":     "sub-thread-1",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !task.Sidechain || task.TaskID != "sub-thread-1" || task.ToolUseID != "call_spawn" || task.AgentID != "sub-thread-1" {
		t.Fatalf("unexpected codex subagent task frame: %#v", task)
	}

	result, err := AdaptCodexOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "codex",
		Message: map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{
						"type":        "tool_result",
						"tool_use_id": "call_spawn",
						"content": []any{
							map[string]any{"type": "text", "text": "stdout: done"},
							map[string]any{"type": "text", "text": "agentId: sub-thread-1"},
						},
					},
				},
			},
			"tool_use_result": map[string]any{
				"status":  "completed",
				"agentId": "sub-thread-1",
			},
		},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if result.AgentID != "sub-thread-1" || result.Content[0].ToolUseID != "call_spawn" {
		t.Fatalf("unexpected codex subagent result frame: %#v", result)
	}
}

func TestClaudeAdapterMarksAsyncBackgroundAgentFramesAsSidechain(t *testing.T) {
	launcher, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role": "assistant",
				"content": []any{
					map[string]any{
						"type": "tool_use",
						"id":   "toolu_agent",
						"name": "Agent",
						"input": map[string]any{
							"description":       "Summarize recent git history",
							"run_in_background": true,
						},
					},
				},
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !launcher.Sidechain {
		t.Fatalf("async Agent launcher should be sidechain/control activity: %#v", launcher)
	}

	launchResult, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{"type": "tool_result", "tool_use_id": "toolu_agent", "content": "Async agent launched successfully."},
				},
			},
			"toolUseResult": map[string]any{
				"isAsync":    true,
				"status":     "async_launched",
				"agentId":    "agent-1",
				"outputFile": "C:\\temp\\agent-1.output",
			},
		},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !launchResult.Sidechain || launchResult.AgentID != "agent-1" {
		t.Fatalf("async launch result should stay in task channel with agent id: %#v", launchResult)
	}
}

func TestClaudeAdapterMarksTaskNotificationPromptAsSidechain(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "user",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "user",
			"origin": map[string]any{
				"kind": "task-notification",
			},
			"message": map[string]any{
				"role":    "user",
				"content": "<task-notification>\n<task-id>agent-1</task-id>\n<status>completed</status>\n</task-notification>",
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !frame.Sidechain || frame.AgentID != "agent-1" {
		t.Fatalf("task-notification prompt should be control sidechain with task id: %#v", frame)
	}
}

func TestClaudeAdapterMarksAssistantEndTurnAsCompletedRuntime(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role":        "assistant",
				"stop_reason": "end_turn",
				"content": []any{
					map[string]any{"type": "text", "text": "done"},
				},
			},
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindResult {
		t.Fatalf("assistant end_turn should be a terminal result frame, got %q", frame.Kind)
	}
	if frame.Runtime == nil || frame.Runtime.Phase != "completed" {
		t.Fatalf("assistant end_turn should carry completed runtime snapshot: %#v", frame.Runtime)
	}
	if frame.Success == nil || !*frame.Success {
		t.Fatalf("assistant end_turn should be successful: %#v", frame.Success)
	}
}

func TestClaudeAdapterMarksRawResultEventAsResultFrame(t *testing.T) {
	frame, err := AdaptClaudeOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		Subtype:   "result",
		SessionID: "runtime-1",
		Provider:  "claude",
		Message: map[string]any{
			"type":     "result",
			"subtype":  "success",
			"result":   "ok",
			"is_error": false,
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindResult {
		t.Fatalf("raw result event should be a result frame, got %q", frame.Kind)
	}
	if frame.Runtime == nil || frame.Runtime.Phase != "completed" {
		t.Fatalf("raw result event should carry completed runtime snapshot: %#v", frame.Runtime)
	}
}

func TestProviderAdapterPreservesResultErrorMessage(t *testing.T) {
	frame, err := AdaptUnifiedOutput(ProviderOutputContext{}, provider.OutputEvent{
		Type:      "assistant",
		Subtype:   "result",
		SessionID: "runtime-1",
		Provider:  "pi",
		Message: map[string]any{
			"type":    "result",
			"subtype": "error",
			"error":   "Request timed out.",
			"message": "Request timed out.",
		},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}

	if frame.Kind != FrameKindResult {
		t.Fatalf("result error should be a result frame, got %q", frame.Kind)
	}
	if frame.Success == nil || *frame.Success {
		t.Fatalf("result error should be unsuccessful: %#v", frame.Success)
	}
	if !frame.IsError {
		t.Fatal("result error should set IsError")
	}
	if frame.Error != "Request timed out." {
		t.Fatalf("result error message = %q", frame.Error)
	}
	if len(frame.Content) != 1 || frame.Content[0].Text != "Request timed out." {
		t.Fatalf("result error content = %#v", frame.Content)
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
