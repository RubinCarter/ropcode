package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"ropcode/internal/provider"
)

func contentBlocksFromInner(inner map[string]interface{}) []map[string]interface{} {
	if blocks, ok := inner["content"].([]map[string]interface{}); ok {
		return blocks
	}
	if blocks, ok := inner["content"].([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(blocks))
		for _, b := range blocks {
			if m, ok := b.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	return nil
}

func samplesDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "scripts", "protocol-samples", "output")
}

func loadSample(t *testing.T, relPath string) map[string]any {
	t.Helper()
	path := filepath.Join(samplesDir(), relPath)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("sample file not found: %s", path)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("invalid JSON in %s: %v", relPath, err)
	}
	return raw
}

func loadLiveLines(t *testing.T, filename string) []map[string]any {
	t.Helper()
	path := filepath.Join(samplesDir(), "live", filename)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("live capture file not found: %s", path)
	}
	var results []map[string]any
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal(line, &obj); err == nil {
			results = append(results, obj)
		}
	}
	return results
}

func splitLines(data []byte) [][]byte {
	var lines [][]byte
	start := 0
	for i, b := range data {
		if b == '\n' {
			lines = append(lines, data[start:i])
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	return lines
}

// =============================================================================
// Tests using real extracted JSONL samples from ~/.codex/sessions/
// =============================================================================

func TestRealHistory_EventMsg_AgentMessage(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__agent_message.json")
	ev := NormalizeHistoryEntry(raw)
	if !ev.Suppressed() {
		t.Fatalf("event_msg/agent_message should be suppressed, got %#v", ev)
	}
}

func TestRealHistory_EventMsg_AgentReasoning(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__agent_reasoning.json")
	ev := NormalizeHistoryEntry(raw)
	if !ev.Suppressed() {
		t.Fatalf("event_msg/agent_reasoning should be suppressed, got %#v", ev)
	}
}

func TestRealHistory_EventMsg_UserMessage(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__user_message.json")
	ev := NormalizeHistoryEntry(raw)
	if !ev.Suppressed() {
		t.Fatalf("event_msg/user_message should be suppressed, got %#v", ev)
	}
}

func TestRealHistory_EventMsg_TaskStarted(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__task_started.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "system", "event_msg/task_started type")
	assertHistorySubtype(t, ev, "turn_started", "event_msg/task_started subtype")
}

func TestRealHistory_EventMsg_TaskComplete(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__task_complete.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "assistant", "event_msg/task_complete type")
	assertHistorySubtype(t, ev, "result", "event_msg/task_complete subtype")
	if ev.Message["type"] != "result" {
		t.Fatalf("expected result message, got %v", ev.Message)
	}
}

func TestRealHistory_EventMsg_TokenCount(t *testing.T) {
	raw := loadSample(t, "codex/event_msg__token_count.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "system", "event_msg/token_count type")
	assertHistorySubtype(t, ev, "token_usage", "event_msg/token_count subtype")
	usage, _ := ev.Message["usage"].(map[string]any)
	if usage == nil {
		t.Fatal("usage should not be nil")
	}
	if usage["input_tokens"] == nil {
		t.Fatal("input_tokens should be present")
	}
}

func TestRealHistory_ResponseItem_FunctionCall_ExecCommand(t *testing.T) {
	raw := loadSample(t, "codex/response_item__function_call__exec_command.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "assistant", "function_call/exec_command type")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
	if blocks[0]["name"] != "Bash" && blocks[0]["name"] != "Read" && blocks[0]["name"] != "Write" && blocks[0]["name"] != "Grep" && blocks[0]["name"] != "Glob" && blocks[0]["name"] != "LS" {
		t.Fatalf("expected mapped tool name, got %v", blocks[0]["name"])
	}
	id, _ := blocks[0]["id"].(string)
	if id == "" {
		t.Fatal("tool_use id should not be empty")
	}
}

func TestRealHistory_ResponseItem_FunctionCall_SpawnAgent(t *testing.T) {
	raw := loadSample(t, "codex/response_item__function_call__multi_agent_v1_spawn_agent.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "assistant", "function_call/spawn_agent type")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
	if blocks[0]["name"] != "Agent" {
		t.Fatalf("expected name=Agent, got %v", blocks[0]["name"])
	}
}

func TestRealHistory_ResponseItem_FunctionCall_WaitAgent(t *testing.T) {
	raw := loadSample(t, "codex/response_item__function_call__multi_agent_v1_wait_agent.json")
	ev := NormalizeHistoryEntry(raw)

	// wait_agent should be suppressed (nil message)
	if ev.Message != nil {
		t.Fatalf("wait_agent should produce nil message, got %v", ev.Message)
	}
}

func TestRealHistory_ResponseItem_FunctionCallOutput(t *testing.T) {
	raw := loadSample(t, "codex/response_item__function_call_output.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "user", "function_call_output type")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
	id, _ := blocks[0]["tool_use_id"].(string)
	if id == "" {
		t.Fatal("tool_use_id should not be empty")
	}
	content, _ := blocks[0]["content"].(string)
	if content == "" {
		t.Fatal("tool_result content should not be empty")
	}
}

func TestRealHistory_ResponseItem_Reasoning(t *testing.T) {
	raw := loadSample(t, "codex/response_item__reasoning.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Suppressed() {
		return
	}
	assertHistoryType(t, ev, "assistant", "reasoning type")
	// reasoning may have encrypted_content only (no readable text)
	if ev.Message == nil {
		t.Skip("reasoning has no readable content (encrypted)")
	}
}

func TestRealHistory_ResponseItem_WebSearchCall(t *testing.T) {
	raw := loadSample(t, "codex/response_item__web_search_call.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "assistant", "web_search_call type")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
	if blocks[0]["name"] != "WebSearch" {
		t.Fatalf("expected name=WebSearch, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["query"] == "" {
		t.Fatalf("expected non-empty WebSearch query, got %v", input["query"])
	}
}

func TestRealHistory_ResponseItem_Message_Developer(t *testing.T) {
	raw := loadSample(t, "codex/response_item__message.json")
	ev := NormalizeHistoryEntry(raw)

	// Developer messages should be suppressed (nil message)
	// or if it's a regular message, should produce text
	if ev.Message == nil {
		// developer message correctly suppressed
		return
	}
	assertHistoryType(t, ev, "assistant", "message type")
}

func TestRealHistory_SessionMeta(t *testing.T) {
	raw := loadSample(t, "codex/session_meta.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "system", "session_meta type")
	assertHistorySubtype(t, ev, "init", "session_meta subtype")
}

func TestRealHistory_SessionMeta_Subagent(t *testing.T) {
	raw := loadSample(t, "codex/session_meta__subagent.json")
	ev := NormalizeHistoryEntry(raw)

	assertHistoryType(t, ev, "system", "session_meta/subagent type")
	assertHistorySubtype(t, ev, "init", "session_meta/subagent subtype")
}

// =============================================================================
// Tests using real live capture data
// =============================================================================

func TestRealLive_InteractiveProtocol_AllEvents(t *testing.T) {
	lines := loadLiveLines(t, "codex_subagent_complete.jsonl")
	if len(lines) == 0 {
		t.Skip("no live capture data")
	}

	d := &Driver{}
	var events []*provider.OutputEvent
	for _, raw := range lines {
		data, _ := json.Marshal(raw)
		ev := d.ParseOutput(data)
		events = append(events, ev)
	}

	// Verify we got the expected event types from a real session
	var hasToolUse, hasToolResult, hasText, hasDelta, hasResult bool
	for _, ev := range events {
		if ev == nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			if ev.Subtype == "result" {
				hasResult = true
			} else if ev.IsDelta {
				hasDelta = true
				if ev.Message != nil {
					inner, _ := ev.Message["message"].(map[string]interface{})
					blocks := contentBlocksFromInner(inner)
					if len(blocks) > 0 {
						ct, _ := blocks[0]["type"].(string)
						if ct == "text" {
							hasText = true
						}
					}
				}
			} else if ev.Message != nil {
				msg := ev.Message
				inner, _ := msg["message"].(map[string]interface{})
				if inner != nil {
					blocks := contentBlocksFromInner(inner)
					if len(blocks) > 0 {
						ct, _ := blocks[0]["type"].(string)
						if ct == "tool_use" {
							hasToolUse = true
						} else if ct == "text" {
							hasText = true
						}
					}
				}
			}
		case "user":
			if ev.Message != nil {
				msg := ev.Message
				inner, _ := msg["message"].(map[string]interface{})
				if inner != nil {
					blocks := contentBlocksFromInner(inner)
					if len(blocks) > 0 {
						ct, _ := blocks[0]["type"].(string)
						if ct == "tool_result" {
							hasToolResult = true
						}
					}
				}
			}
		}
	}

	if !hasToolUse {
		t.Error("expected at least one tool_use event from real capture")
	}
	if !hasToolResult {
		t.Error("expected at least one tool_result event from real capture")
	}
	if !hasText {
		t.Error("expected at least one text event from real capture")
	}
	if !hasDelta {
		t.Error("expected at least one delta event from real capture")
	}
	if !hasResult {
		t.Error("expected a result event from real capture")
	}
}

func TestRealLive_BatchProtocol_AllEvents(t *testing.T) {
	lines := loadLiveLines(t, "codex_stdio_batch.jsonl")
	if len(lines) == 0 {
		t.Skip("no batch capture data")
	}

	d := &Driver{}
	var hasToolUse, hasToolResult, hasText, hasResult bool
	for _, raw := range lines {
		data, _ := json.Marshal(raw)
		ev := d.ParseOutput(data)
		if ev == nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			if ev.Subtype == "result" {
				hasResult = true
			} else if ev.Message != nil {
				msg := ev.Message
				inner, _ := msg["message"].(map[string]interface{})
				if inner != nil {
					blocks := contentBlocksFromInner(inner)
					if len(blocks) > 0 {
						ct, _ := blocks[0]["type"].(string)
						if ct == "tool_use" {
							hasToolUse = true
						} else if ct == "text" {
							hasText = true
						}
					}
				}
			}
		case "user":
			hasToolResult = true
		}
	}

	if !hasToolUse {
		t.Error("expected tool_use from batch capture")
	}
	if !hasToolResult {
		t.Error("expected tool_result from batch capture")
	}
	if !hasText {
		t.Error("expected text from batch capture")
	}
	if !hasResult {
		t.Error("expected result from batch capture")
	}
}

func TestRealLive_WebSearch_Events(t *testing.T) {
	lines := loadLiveLines(t, "codex_websearch_capture.jsonl")
	if len(lines) == 0 {
		t.Skip("no websearch capture data")
	}

	d := &Driver{}
	var hasWebSearchUse bool
	var emptyWebSearchUses int
	for _, raw := range lines {
		data, _ := json.Marshal(raw)
		ev := d.ParseOutput(data)
		if ev == nil {
			continue
		}
		if ev.Type == "assistant" && ev.Message != nil {
			inner, _ := ev.Message["message"].(map[string]interface{})
			if inner != nil {
				blocks := contentBlocksFromInner(inner)
				if len(blocks) > 0 {
					name, _ := blocks[0]["name"].(string)
					if name == "WebSearch" {
						hasWebSearchUse = true
						input, _ := blocks[0]["input"].(map[string]interface{})
						if input["query"] == "" {
							emptyWebSearchUses++
						}
					}
				}
			}
		}
	}

	if !hasWebSearchUse {
		t.Error("expected WebSearch tool_use from websearch capture")
	}
	if emptyWebSearchUses > 0 {
		t.Errorf("expected no empty WebSearch queries, got %d", emptyWebSearchUses)
	}
}

func TestRealLive_Subagent_Events(t *testing.T) {
	lines := loadLiveLines(t, "codex_subagent_complete.jsonl")
	if len(lines) == 0 {
		t.Skip("no subagent capture data")
	}

	d := &Driver{}
	var hasAgentUse, hasAgentResult bool
	for _, raw := range lines {
		data, _ := json.Marshal(raw)
		ev := d.ParseOutput(data)
		if ev == nil {
			continue
		}
		if ev.Type == "assistant" && ev.Message != nil {
			inner, _ := ev.Message["message"].(map[string]interface{})
			if inner != nil {
				blocks := contentBlocksFromInner(inner)
				if len(blocks) > 0 {
					name, _ := blocks[0]["name"].(string)
					if name == "Agent" || name == "AgentWait" {
						hasAgentUse = true
					}
				}
			}
		}
		if ev.Type == "user" && ev.Message != nil {
			inner, _ := ev.Message["message"].(map[string]interface{})
			if inner != nil {
				blocks := contentBlocksFromInner(inner)
				if len(blocks) > 0 {
					id, _ := blocks[0]["tool_use_id"].(string)
					if len(id) > 5 && id[:5] == "call_" {
						hasAgentResult = true
					}
				}
			}
		}
	}

	if !hasAgentUse {
		t.Error("expected Agent tool_use from subagent capture")
	}
	if !hasAgentResult {
		t.Error("expected Agent tool_result from subagent capture")
	}
}
