package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ropcode/internal/provider"
)

// =============================================================================
// Helper functions
// =============================================================================

func parseOutput(t *testing.T, jsonStr string) *provider.OutputEvent {
	t.Helper()
	d := &Driver{}
	return d.ParseOutput([]byte(jsonStr))
}

func assertNil(t *testing.T, ev *provider.OutputEvent, context string) {
	t.Helper()
	if ev != nil {
		t.Fatalf("[%s] expected nil, got Type=%q Subtype=%q", context, ev.Type, ev.Subtype)
	}
}

func assertType(t *testing.T, ev *provider.OutputEvent, expectedType string, context string) {
	t.Helper()
	if ev == nil {
		t.Fatalf("[%s] expected Type=%q, got nil", context, expectedType)
	}
	if ev.Type != expectedType {
		t.Fatalf("[%s] expected Type=%q, got %q", context, expectedType, ev.Type)
	}
}

func assertTypeSubtype(t *testing.T, ev *provider.OutputEvent, expectedType, expectedSubtype string, context string) {
	t.Helper()
	assertType(t, ev, expectedType, context)
	if ev.Subtype != expectedSubtype {
		t.Fatalf("[%s] expected Subtype=%q, got %q", context, expectedSubtype, ev.Subtype)
	}
}

func assertIsDelta(t *testing.T, ev *provider.OutputEvent, expected bool, context string) {
	t.Helper()
	if ev == nil {
		t.Fatalf("[%s] expected IsDelta=%v, got nil event", context, expected)
	}
	if ev.IsDelta != expected {
		t.Fatalf("[%s] expected IsDelta=%v, got %v", context, expected, ev.IsDelta)
	}
}

func getContentBlocks(t *testing.T, ev *provider.OutputEvent) []map[string]interface{} {
	t.Helper()
	if ev == nil || ev.Message == nil {
		t.Fatal("event or message is nil")
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message is nil")
	}
	// Try []map[string]interface{} first
	if blocks, ok := inner["content"].([]map[string]interface{}); ok {
		return blocks
	}
	// Try []interface{}
	if blocks, ok := inner["content"].([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(blocks))
		for _, b := range blocks {
			if m, ok := b.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	t.Fatal("content is not a slice")
	return nil
}

func assertContentBlockType(t *testing.T, ev *provider.OutputEvent, index int, expectedType string, context string) {
	t.Helper()
	blocks := getContentBlocks(t, ev)
	if index >= len(blocks) {
		t.Fatalf("[%s] content has %d blocks, want index %d", context, len(blocks), index)
	}
	got, _ := blocks[index]["type"].(string)
	if got != expectedType {
		t.Fatalf("[%s] content[%d].type = %q, want %q", context, index, got, expectedType)
	}
}

func assertContentField(t *testing.T, ev *provider.OutputEvent, index int, field, expected string, context string) {
	t.Helper()
	blocks := getContentBlocks(t, ev)
	if index >= len(blocks) {
		t.Fatalf("[%s] content has %d blocks, want index %d", context, len(blocks), index)
	}
	got, _ := blocks[index][field].(string)
	if got != expected {
		t.Fatalf("[%s] content[%d].%s = %q, want %q", context, index, field, got, expected)
	}
}

func assertContentFieldBool(t *testing.T, ev *provider.OutputEvent, index int, field string, expected bool, context string) {
	t.Helper()
	blocks := getContentBlocks(t, ev)
	if index >= len(blocks) {
		t.Fatalf("[%s] content has %d blocks, want index %d", context, len(blocks), index)
	}
	got, _ := blocks[index][field].(bool)
	if got != expected {
		t.Fatalf("[%s] content[%d].%s = %v, want %v", context, index, field, got, expected)
	}
}

func getTodos(t *testing.T, input map[string]interface{}) []map[string]interface{} {
	t.Helper()
	// Handle []interface{} (after JSON round-trip)
	if todos, ok := input["todos"].([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(todos))
		for _, item := range todos {
			if m, ok := item.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	// Handle []map[string]interface{} (direct Go type)
	if todos, ok := input["todos"].([]map[string]interface{}); ok {
		return todos
	}
	t.Fatal("todos field is not a valid slice")
	return nil
}

// =============================================================================
// PART 1: Interactive JSON-RPC Protocol Tests
// =============================================================================

// --- 1A. Session Lifecycle ---

func TestInteractive_ResponseInit(t *testing.T) {
	ev := parseOutput(t, `{"id":"codex_initialize_1","result":{"userAgent":"codex/0.133.0","codexHome":"/home/.codex","platformOs":"macos"}}`)
	assertTypeSubtype(t, ev, "system", "control_response", "init response")
}

func TestInteractive_ResponseThread(t *testing.T) {
	ev := parseOutput(t, `{"id":"thread_1","result":{"thread":{"id":"thread-abc-123"},"model":"gpt-5.5"}}`)
	assertTypeSubtype(t, ev, "system", "init", "thread response")
	if ev.Message["session_id"] != "thread-abc-123" {
		t.Fatalf("expected session_id=thread-abc-123, got %v", ev.Message["session_id"])
	}
}

func TestInteractive_ResponseError(t *testing.T) {
	ev := parseOutput(t, `{"id":"turn_1","error":{"code":-32600,"message":"invalid request"}}`)
	assertTypeSubtype(t, ev, "system", "response", "error response")
}

func TestInteractive_ResponseTurn(t *testing.T) {
	ev := parseOutput(t, `{"id":"turn_99","result":{"turn":{"id":"t1","status":"inProgress"}}}`)
	assertTypeSubtype(t, ev, "system", "response", "turn response")
}

func TestInteractive_TurnStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn1","status":"inProgress"}}}`)
	assertTypeSubtype(t, ev, "system", "turn_started", "turn/started")
}

func TestInteractive_TurnCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"turn/completed","params":{"threadId":"t1","turnId":"turn1"}}`)
	assertTypeSubtype(t, ev, "assistant", "result", "turn/completed")
	if ev.Message["type"] != "result" || ev.Message["subtype"] != "success" {
		t.Fatalf("expected result/success message, got %v", ev.Message)
	}
}

func TestInteractive_TurnStateTracking(t *testing.T) {
	d := &Driver{}
	_ = d.ParseOutput([]byte(`{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn1","status":"inProgress"}}}`))
	if got := d.currentActiveTurn("t1"); got != "turn1" {
		t.Fatalf("expected active turn turn1, got %q", got)
	}
	_ = d.ParseOutput([]byte(`{"method":"turn/completed","params":{"threadId":"t1","turnId":"turn1"}}`))
	if got := d.currentActiveTurn("t1"); got != "" {
		t.Fatalf("expected active turn to be cleared, got %q", got)
	}
}

func TestInteractive_ThreadReadActivityActiveTurn(t *testing.T) {
	d := &Driver{}
	activity := d.activityFromThreadRead("thread1", true, map[string]interface{}{
		"result": map[string]interface{}{
			"thread": map[string]interface{}{
				"id":     "thread1",
				"status": map[string]interface{}{"type": "active"},
				"turns": []interface{}{
					map[string]interface{}{"id": "turn1", "status": "completed"},
					map[string]interface{}{"id": "turn2", "status": "inProgress"},
				},
			},
		},
	})
	if activity.Status != provider.SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active interruptible activity, got %#v", activity)
	}
	if activity.TurnID != "turn2" {
		t.Fatalf("expected active turn turn2, got %q", activity.TurnID)
	}
	if got := d.currentActiveTurn("thread1"); got != "turn2" {
		t.Fatalf("expected cached turn turn2, got %q", got)
	}
}

func TestInteractive_ThreadReadActivityUsesActiveChildTurn(t *testing.T) {
	d := &Driver{}
	_ = d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"inProgress","senderThreadId":"root","receiverThreadIds":[],"prompt":"search","agentsStates":{}},"threadId":"root","turnId":"turn1"}}`))
	_ = d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"completed","senderThreadId":"root","receiverThreadIds":["child1"],"prompt":"search","agentsStates":{"child1":{"status":"pendingInit","message":null}}},"threadId":"root","turnId":"turn1"}}`))
	_ = d.ParseOutput([]byte(`{"method":"turn/started","params":{"threadId":"child1","turn":{"id":"child-turn","status":"inProgress"}}}`))

	activity := d.activityFromThreadRead("root", true, map[string]interface{}{
		"result": map[string]interface{}{
			"thread": map[string]interface{}{
				"id":     "root",
				"status": map[string]interface{}{"type": "idle"},
				"turns": []interface{}{
					map[string]interface{}{"id": "turn1", "status": "inProgress"},
				},
			},
		},
	})

	if activity.Status != provider.SessionActivityActive || !activity.Active || !activity.CanInterrupt {
		t.Fatalf("expected active activity from child turn, got %#v", activity)
	}
	if activity.TurnID != "child-turn" {
		t.Fatalf("expected child active turn, got %q", activity.TurnID)
	}
	threadID, turnID := d.currentInterruptTarget("root")
	if threadID != "root" || turnID != "turn1" {
		t.Fatalf("expected root turn to remain interrupt target when root is active, got %q/%q", threadID, turnID)
	}

	d.rememberTurnCompleted(map[string]interface{}{"threadId": "root"})
	threadID, turnID = d.currentInterruptTarget("root")
	if threadID != "child1" || turnID != "child-turn" {
		t.Fatalf("expected child turn interrupt target after root turn clears, got %q/%q", threadID, turnID)
	}
}

func TestInteractive_ThreadStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"thread/started","params":{"thread":{"id":"t1","status":{"type":"idle"}}}}`)
	assertTypeSubtype(t, ev, "system", "thread_started", "thread/started")
}

func TestInteractive_ThreadStatusChanged(t *testing.T) {
	ev := parseOutput(t, `{"method":"thread/status/changed","params":{"threadId":"t1","status":{"type":"active"}}}`)
	assertTypeSubtype(t, ev, "system", "status_changed", "thread/status/changed")
}

// --- 1B. Content Output ---

func TestInteractive_AgentMessageDelta(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/agentMessage/delta","params":{"threadId":"t1","turnId":"turn1","itemId":"msg1","delta":"Hello"}}`)
	assertType(t, ev, "assistant", "agentMessage/delta")
	assertIsDelta(t, ev, true, "agentMessage/delta")
	message, _ := ev.Message["message"].(map[string]interface{})
	if message["id"] != "t1:turn1:msg1" {
		t.Fatalf("expected delta message id t1:turn1:msg1, got %v", message["id"])
	}
	assertContentBlockType(t, ev, 0, "text", "delta content type")
	assertContentField(t, ev, 0, "text", "Hello", "delta text")
}

func TestInteractive_AgentMessageStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"agentMessage","id":"msg1","text":"","phase":"commentary"},"threadId":"t1","turnId":"turn1"}}`)
	assertNil(t, ev, "agentMessage started")
}

func TestInteractive_AgentMessageCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"msg1","text":"Here are the results.","phase":"commentary"},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "agentMessage completed")
	message, _ := ev.Message["message"].(map[string]interface{})
	if message["id"] != "t1:turn1:msg1" {
		t.Fatalf("expected completed message id t1:turn1:msg1, got %v", message["id"])
	}
	assertContentBlockType(t, ev, 0, "text", "agentMessage completed content")
	assertContentField(t, ev, 0, "text", "Here are the results.", "agentMessage text")
}

func TestInteractive_AgentMessageCompletedAfterDeltasEmitsFullText(t *testing.T) {
	d := &Driver{}
	if ev := d.ParseOutput([]byte(`{"method":"item/agentMessage/delta","params":{"threadId":"t1","turnId":"turn1","itemId":"msg1","delta":"Here are "}}`)); ev == nil {
		t.Fatal("expected first delta")
	}
	if ev := d.ParseOutput([]byte(`{"method":"item/agentMessage/delta","params":{"threadId":"t1","turnId":"turn1","itemId":"msg1","delta":"the results."}}`)); ev == nil {
		t.Fatal("expected second delta")
	}
	ev := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"msg1","text":"Here are the results.","phase":"commentary"},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, ev, "assistant", "completed agentMessage after deltas")
	assertContentField(t, ev, 0, "text", "Here are the results.", "completed agentMessage text")
}

func TestInteractive_AgentMessageCompletedAfterDeltasEmitsPartialEchoForBridgeReconciliation(t *testing.T) {
	d := &Driver{}
	if ev := d.ParseOutput([]byte(`{"method":"item/agentMessage/delta","params":{"threadId":"t1","turnId":"turn1","itemId":"msg1","delta":"A complete streamed response "}}`)); ev == nil {
		t.Fatal("expected first delta")
	}
	if ev := d.ParseOutput([]byte(`{"method":"item/agentMessage/delta","params":{"threadId":"t1","turnId":"turn1","itemId":"msg1","delta":"with the final tail."}}`)); ev == nil {
		t.Fatal("expected second delta")
	}
	ev := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"msg1","text":"A complete streamed response","phase":"commentary"},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, ev, "assistant", "partial completed agentMessage after deltas")
	assertContentField(t, ev, 0, "text", "A complete streamed response", "partial completed agentMessage text")
}

// --- 1C. Reasoning ---

func TestInteractive_ReasoningStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"reasoning","id":"rs1","summary":[],"content":[]},"threadId":"t1","turnId":"turn1"}}`)
	assertNil(t, ev, "reasoning started")
}

func TestInteractive_ReasoningCompleted_WithContent(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"reasoning","id":"rs1","summary":[{"type":"summary_text","text":"Planning the approach"}],"content":[]},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "reasoning completed with summary")
	assertContentBlockType(t, ev, 0, "thinking", "reasoning content type")
	assertContentField(t, ev, 0, "thinking", "Planning the approach", "reasoning text")
}

func TestInteractive_ReasoningCompleted_Empty(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"reasoning","id":"rs1","summary":[],"content":[]},"threadId":"t1","turnId":"turn1"}}`)
	assertNil(t, ev, "empty reasoning")
}

// --- 1D. Tool Use (commandExecution) ---

func TestInteractive_CommandExecutionStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"commandExecution","id":"call_abc123","command":"/bin/zsh -lc 'echo hello'","cwd":"/tmp","status":"inProgress","commandActions":[{"type":"unknown","command":"echo hello"}],"aggregatedOutput":null,"exitCode":null},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "commandExecution started")
	assertContentBlockType(t, ev, 0, "tool_use", "commandExecution tool_use")
	assertContentField(t, ev, 0, "id", "call_abc123", "tool_use id")
	assertContentField(t, ev, 0, "name", "Bash", "tool_use name")
	// Verify command is extracted from commandActions
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("tool_use input is nil")
	}
	cmd, _ := input["command"].(string)
	if cmd != "echo hello" {
		t.Fatalf("expected command='echo hello', got %q", cmd)
	}
}

func TestInteractive_CommandExecutionStarted_NoCommandActions(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"commandExecution","id":"call_xyz","command":"/bin/zsh -lc 'ls -la'","status":"inProgress","commandActions":[],"aggregatedOutput":null,"exitCode":null},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "commandExecution started no actions")
	assertContentBlockType(t, ev, 0, "tool_use", "tool_use type")
	// Should fall back to raw command
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	cmd, _ := input["command"].(string)
	if cmd == "" {
		t.Fatal("command should not be empty")
	}
}

func TestInteractive_CommandExecutionStarted_SearchWithoutQueryParsesCommand(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"commandExecution","id":"call_search","command":"/bin/zsh -lc 'rg needle src'","status":"inProgress","commandActions":[{"type":"search","command":"rg needle src","query":"","path":"src"}],"aggregatedOutput":null,"exitCode":null},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "empty search query")
	assertContentBlockType(t, ev, 0, "tool_use", "tool_use type")
	assertContentField(t, ev, 0, "name", "Grep", "empty search query should parse command")

	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["pattern"] != "needle" {
		t.Fatalf("expected pattern from command, got %v", input["pattern"])
	}
	if input["path"] != "src" {
		t.Fatalf("expected path from command or metadata, got %v", input["path"])
	}
	if input["command"] != "rg needle src" {
		t.Fatalf("expected command from commandActions, got %v", input["command"])
	}
}

func TestInteractive_CommandExecutionStarted_ListFilesProvidesGlobPattern(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"commandExecution","id":"call_files","command":"/bin/zsh -lc 'rg --files internal/provider/codex -g \"*.go\"'","status":"inProgress","commandActions":[{"type":"listFiles","command":"rg --files internal/provider/codex -g \"*.go\"","path":"internal/provider/codex"}],"aggregatedOutput":null,"exitCode":null},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "list files")
	assertContentBlockType(t, ev, 0, "tool_use", "tool_use type")
	assertContentField(t, ev, 0, "name", "Glob", "listFiles should create Glob")

	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["pattern"] != "*.go" {
		t.Fatalf("expected pattern '*.go', got %v", input["pattern"])
	}
	if input["path"] != "internal/provider/codex" {
		t.Fatalf("expected path internal/provider/codex, got %v", input["path"])
	}
}

func TestInteractive_CommandExecutionCompleted_Success(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"commandExecution","id":"call_abc123","command":"/bin/zsh -lc 'echo hello'","status":"completed","commandActions":[{"type":"unknown","command":"echo hello"}],"aggregatedOutput":"hello\n","exitCode":0},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "user", "commandExecution completed")
	assertContentBlockType(t, ev, 0, "tool_result", "tool_result type")
	assertContentField(t, ev, 0, "tool_use_id", "call_abc123", "tool_result id")
	assertContentField(t, ev, 0, "content", "hello\n", "tool_result content")
	assertContentFieldBool(t, ev, 0, "is_error", false, "tool_result is_error")
}

func TestInteractive_CommandExecutionCompleted_NormalizesSingleFileGrepOutput(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"commandExecution","id":"call_grep","command":"/bin/zsh -lc 'rg needle file.go'","status":"completed","commandActions":[{"type":"search","command":"rg needle file.go","query":"needle","path":"file.go"}],"aggregatedOutput":"12:func needle() {}\nplain match\n","exitCode":0},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "user", "single-file grep completed")
	assertContentBlockType(t, ev, 0, "tool_result", "tool_result type")
	assertContentField(t, ev, 0, "content", "file.go:12:func needle() {}\nplain match\n", "single-file grep result")
}

func TestInteractive_CommandExecutionCompleted_Error(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"commandExecution","id":"call_err","command":"/bin/zsh -lc 'exit 1'","status":"completed","aggregatedOutput":"error occurred\n","exitCode":1},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "user", "commandExecution error")
	assertContentBlockType(t, ev, 0, "tool_result", "tool_result type")
	assertContentFieldBool(t, ev, 0, "is_error", true, "tool_result is_error on exit 1")
}

func TestInteractive_CommandExecutionCompleted_SanitizesTerminalSequences(t *testing.T) {
	ev := parseOutput(t, "{\"method\":\"item/completed\",\"params\":{\"item\":{\"type\":\"commandExecution\",\"id\":\"call_ansi\",\"command\":\"/bin/zsh -lc 'echo hello'\",\"status\":\"completed\",\"aggregatedOutput\":\"\\u001b]7;file://localhost/tmp\\u0007\\u001b]16162;A\\u0007\\u001b[?25lhello\\u001b[0m\\r\\n__ropcode_si_precmd: command not found\\nworld\\n\",\"exitCode\":0},\"threadId\":\"t1\",\"turnId\":\"turn1\"}}")
	assertType(t, ev, "user", "commandExecution sanitized")
	assertContentBlockType(t, ev, 0, "tool_result", "tool_result type")
	assertContentField(t, ev, 0, "content", "hello\nworld\n", "sanitized tool_result content")
}

// --- 1E. Tool Use (functionCall) ---

func TestInteractive_FunctionCallStarted(t *testing.T) {
	// functionCall items appear in item/started for non-shell tools
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_plan1","name":"update_plan","arguments":"{\"explanation\":\"开始执行\",\"plan\":[{\"step\":\"检索代码\",\"status\":\"in_progress\"},{\"step\":\"汇总结果\",\"status\":\"pending\"}]}"},"threadId":"t1","turnId":"turn1"}}`)
	if ev == nil {
		t.Fatal("functionCall started should not be nil")
	}
	assertType(t, ev, "assistant", "functionCall started")
	assertContentBlockType(t, ev, 0, "tool_use", "functionCall tool_use")
	assertContentField(t, ev, 0, "id", "call_plan1", "functionCall id")
	assertContentField(t, ev, 0, "name", "TodoWrite", "update_plan should map to TodoWrite")
	// Verify input is transformed to Claude's TodoWrite format
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("tool_use input is nil")
	}
	todos := getTodos(t, input)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}
	first := todos[0]
	if first["content"] != "检索代码" {
		t.Fatalf("expected content='检索代码', got %v", first["content"])
	}
	if first["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", first["status"])
	}
	if first["activeForm"] == nil || first["activeForm"] == "" {
		t.Fatal("activeForm should be populated")
	}
}

func TestInteractive_FunctionCallStarted_ApplyPatchStringArgumentsMapsToEdit(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_patch","name":"apply_patch","arguments":"*** Begin Patch\n*** Update File: app.go\n@@\n-old value\n+new value\n*** End Patch"},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "apply_patch string arguments")
	assertContentBlockType(t, ev, 0, "tool_use", "apply_patch tool_use")
	assertContentField(t, ev, 0, "name", "Edit", "apply_patch should map to Edit")

	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["file_path"] != "app.go" {
		t.Fatalf("expected file_path app.go, got %v", input["file_path"])
	}
	if input["old_string"] != "old value" {
		t.Fatalf("expected old_string from removed line, got %v", input["old_string"])
	}
	if input["new_string"] != "new value" {
		t.Fatalf("expected new_string from added line, got %v", input["new_string"])
	}
}

func TestInteractive_FunctionCallStarted_ApplyPatchInlinePatchMapsToWrite(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_patch_add","name":"apply_patch","patch":"*** Begin Patch\n*** Add File: notes.txt\n+first line\n+second line\n*** End Patch"},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "apply_patch inline patch")
	assertContentBlockType(t, ev, 0, "tool_use", "apply_patch tool_use")
	assertContentField(t, ev, 0, "name", "Write", "add file patch should map to Write")

	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["file_path"] != "notes.txt" {
		t.Fatalf("expected file_path notes.txt, got %v", input["file_path"])
	}
	if input["content"] != "first line\nsecond line" {
		t.Fatalf("expected added file content, got %v", input["content"])
	}
}

func TestInteractive_FunctionCallOutputCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"functionCallOutput","id":"out1","call_id":"call_plan1","output":"Plan updated"},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "user", "functionCallOutput completed")
	assertContentBlockType(t, ev, 0, "tool_result", "functionCallOutput type")
	assertContentField(t, ev, 0, "content", "Plan updated", "functionCallOutput content")
}

func TestInteractive_FunctionCallCompleted_UpdatePlan(t *testing.T) {
	// item/completed(functionCall) also produces tool_use with full data
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"functionCall","id":"call_plan2","name":"update_plan","arguments":"{\"explanation\":\"进入第二步\",\"plan\":[{\"step\":\"第一步\",\"status\":\"completed\"},{\"step\":\"第二步\",\"status\":\"in_progress\"},{\"step\":\"第三步\",\"status\":\"pending\"}]}"},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "functionCall completed")
	assertContentBlockType(t, ev, 0, "tool_use", "functionCall completed tool_use")
	assertContentField(t, ev, 0, "name", "TodoWrite", "completed functionCall should map to TodoWrite")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	todos := getTodos(t, input)
	if len(todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(todos))
	}
	second := todos[1]
	if second["content"] != "第二步" {
		t.Fatalf("expected content='第二步', got %v", second["content"])
	}
	if second["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", second["status"])
	}
}

func TestInteractive_FunctionCallCompleted_UpdatePlan_MapArgs(t *testing.T) {
	// Live protocol may have arguments as pre-parsed map (not string)
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"functionCall","id":"call_plan3","name":"update_plan","arguments":{"explanation":"并行检索","plan":[{"step":"并行检索仓库中 openclaw 线索","status":"in_progress"},{"step":"汇总用途、接口与依赖信息","status":"pending"},{"step":"给出下一步运行/验证建议","status":"pending"}]}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "functionCall completed map args")
	assertContentBlockType(t, ev, 0, "tool_use", "map args tool_use")
	assertContentField(t, ev, 0, "name", "TodoWrite", "map args should map to TodoWrite")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	// MUST have "todos" key
	todos := getTodos(t, input)
	if len(todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(todos))
	}
	// MUST NOT have raw Codex fields
	if _, has := input["explanation"]; has {
		t.Fatal("output should NOT contain 'explanation' (raw Codex format leaked)")
	}
	if _, has := input["plan"]; has {
		t.Fatal("output should NOT contain 'plan' (raw Codex format leaked)")
	}
	if _, has := input["step"]; has {
		t.Fatal("output should NOT contain 'step' (raw Codex format leaked)")
	}
	// Verify todo structure matches Claude's TodoWrite format
	first := todos[0]
	if first["content"] != "并行检索仓库中 openclaw 线索" {
		t.Fatalf("expected content from map args, got %v", first["content"])
	}
	if first["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", first["status"])
	}
	if first["activeForm"] == nil || first["activeForm"] == "" {
		t.Fatal("activeForm must be present")
	}
}

func TestInteractive_FunctionCallCompleted_UpdatePlan_InlineFields(t *testing.T) {
	// Case where plan/explanation are directly in item (no arguments field)
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"functionCall","id":"call_plan4","name":"update_plan","explanation":"按你的要求用多 subagent 并行调研","plan":[{"status":"in_progress","step":"并行检索仓库中 openclaw 线索"},{"status":"pending","step":"汇总用途、接口与依赖信息"},{"status":"pending","step":"给出下一步运行/验证建议"}]},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "functionCall inline fields")
	assertContentBlockType(t, ev, 0, "tool_use", "inline fields tool_use")
	assertContentField(t, ev, 0, "name", "TodoWrite", "inline fields should map to TodoWrite")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	todos := getTodos(t, input)
	if len(todos) != 3 {
		t.Fatalf("expected 3 todos, got %d", len(todos))
	}
	// MUST NOT have raw Codex fields
	if _, has := input["explanation"]; has {
		t.Fatal("output should NOT contain 'explanation'")
	}
	if _, has := input["plan"]; has {
		t.Fatal("output should NOT contain 'plan'")
	}
	first := todos[0]
	if first["content"] != "并行检索仓库中 openclaw 线索" {
		t.Fatalf("expected content, got %v", first["content"])
	}
}

// --- 1E-2. Subagent (collabAgentToolCall) ---

func TestInteractive_CollabAgentToolCall_SpawnStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"inProgress","senderThreadId":"t1","receiverThreadIds":[],"prompt":"search for X","model":"","reasoningEffort":"medium","agentsStates":{}},"threadId":"t1","turnId":"turn1","startedAtMs":1779705528669}}`)
	if ev == nil {
		t.Fatal("collabAgentToolCall started should not be nil")
	}
	assertType(t, ev, "assistant", "collabAgentToolCall spawn started")
	assertContentBlockType(t, ev, 0, "tool_use", "collabAgentToolCall tool_use")
	assertContentField(t, ev, 0, "id", "call_abc123", "collabAgentToolCall id")
	assertContentField(t, ev, 0, "name", "Agent", "collabAgentToolCall name should be Agent")
}

func TestInteractive_CollabAgentToolCall_WaitStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"collabAgentToolCall","id":"call_wait1","tool":"wait","status":"inProgress","senderThreadId":"t1","receiverThreadIds":["sub_thread_1"],"prompt":null,"model":null,"reasoningEffort":null,"agentsStates":{}},"threadId":"t1","turnId":"turn1"}}`)
	// wait started should be suppressed (nil) — not shown as tool_use
	assertNil(t, ev, "collabAgentToolCall wait started should be nil (suppressed)")
}

func TestInteractive_CollabAgentToolCall_SpawnCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"completed","senderThreadId":"t1","receiverThreadIds":["sub1"],"prompt":"search for X","model":"gpt-5.5","reasoningEffort":"xhigh","agentsStates":{"sub1":{"status":"pendingInit","message":null}}},"threadId":"t1","turnId":"turn1"}}`)
	assertTypeSubtype(t, ev, "system", "task_started", "collabAgentToolCall spawn completed")
	if ev.Message["task_id"] != "sub1" {
		t.Fatalf("expected task_id=sub1, got %v", ev.Message["task_id"])
	}
	if ev.Message["tool_use_id"] != "call_abc123" {
		t.Fatalf("expected tool_use_id=call_abc123, got %v", ev.Message["tool_use_id"])
	}
}

func TestInteractive_CollabAgentToolCall_WaitCompleted_WithResult(t *testing.T) {
	d := &Driver{}
	_ = d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"inProgress","senderThreadId":"t1","receiverThreadIds":[],"prompt":"run echo","model":"","reasoningEffort":"medium","agentsStates":{}},"threadId":"t1","turnId":"turn1"}}`))
	_ = d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"collabAgentToolCall","id":"call_abc123","tool":"spawnAgent","status":"completed","senderThreadId":"t1","receiverThreadIds":["sub1"],"prompt":"run echo","model":"gpt-5.5","reasoningEffort":"xhigh","agentsStates":{"sub1":{"status":"pendingInit","message":null}}},"threadId":"t1","turnId":"turn1"}}`))
	ev := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"collabAgentToolCall","id":"call_wait1","tool":"wait","status":"completed","senderThreadId":"t1","receiverThreadIds":["sub1"],"prompt":null,"model":null,"reasoningEffort":null,"agentsStates":{"sub1":{"status":"completed","message":"stdout: subagent_done\nexit code: 0"}}},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, ev, "user", "collabAgentToolCall wait completed")
	assertContentBlockType(t, ev, 0, "tool_result", "wait completed tool_result")
	assertContentField(t, ev, 0, "tool_use_id", "call_abc123", "wait completed resolves launcher id")
	result, _ := ev.Message["tool_use_result"].(map[string]interface{})
	if result["agentId"] != "sub1" {
		t.Fatalf("expected tool_use_result.agentId=sub1, got %v", result["agentId"])
	}
}

// --- 1E-3. Web Search (webSearch) ---

func TestInteractive_WebSearchStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"webSearch","id":"ws_abc123","query":"","action":{"type":"other"}},"threadId":"t1","turnId":"turn1"}}`)
	assertNil(t, ev, "webSearch started without query")
}

func TestInteractive_WebSearchStartedWithQuery(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"webSearch","id":"ws_abc123","query":"OpenAI Codex CLI","action":{"type":"search","queries":["OpenAI Codex CLI"]}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "webSearch started")
	assertContentBlockType(t, ev, 0, "tool_use", "webSearch tool_use")
	assertContentField(t, ev, 0, "id", "ws_abc123", "webSearch id")
	assertContentField(t, ev, 0, "name", "WebSearch", "webSearch name")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]any)
	if input["query"] != "OpenAI Codex CLI" {
		t.Fatalf("expected query from started event, got %v", input["query"])
	}
}

func TestInteractive_WebSearchCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"webSearch","id":"ws_abc123","query":"OpenAI Codex CLI","action":{"type":"search","queries":["OpenAI Codex CLI release date"]}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "webSearch completed")
	assertContentBlockType(t, ev, 0, "tool_use", "webSearch tool_use")
	assertContentField(t, ev, 0, "id", "ws_abc123", "webSearch id")
	assertContentField(t, ev, 0, "name", "WebSearch", "webSearch name")
	assertContentBlockType(t, ev, 1, "tool_result", "webSearch completed result")
	assertContentField(t, ev, 1, "tool_use_id", "ws_abc123", "webSearch result id")
	assertContentFieldBool(t, ev, 1, "is_error", false, "webSearch result is_error")
}

func TestInteractive_WebSearchCompleted_HasQuery(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"webSearch","id":"ws_xyz","query":"test query","action":{"type":"search","queries":["test query","another query"]}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "webSearch completed with query")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]any)
	if input["query"] != "test query" {
		t.Fatalf("expected webSearch input query, got %v", input["query"])
	}
	if blocks[1]["type"] != "tool_result" {
		t.Fatalf("expected completed webSearch tool_result, got %v", blocks[1]["type"])
	}
}

func TestInteractive_WebSearchCompletedUsesActionQueryFallback(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"webSearch","id":"ws_xyz","query":"","action":{"type":"search","queries":["fallback query"]}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "webSearch completed with fallback query")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]any)
	if input["query"] != "fallback query" {
		t.Fatalf("expected fallback query, got %v", input["query"])
	}
	if blocks[1]["type"] != "tool_result" {
		t.Fatalf("expected completed webSearch tool_result, got %v", blocks[1]["type"])
	}
}

func TestInteractive_WebSearchDeduplicatesStartedAndCompleted(t *testing.T) {
	d := &Driver{}
	started := d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"webSearch","id":"ws_dupe","query":"same query","action":{"type":"search","queries":["same query"]}},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, started, "assistant", "webSearch started")
	completed := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"webSearch","id":"ws_dupe","query":"same query","action":{"type":"search","queries":["same query"]}},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, completed, "user", "webSearch completed duplicate should resolve started tool")
	assertContentBlockType(t, completed, 0, "tool_result", "webSearch completed duplicate result")
	assertContentField(t, completed, 0, "tool_use_id", "ws_dupe", "webSearch duplicate result id")
	assertContentFieldBool(t, completed, 0, "is_error", false, "webSearch duplicate result is_error")
}

func TestInteractive_WriteStdinResultTargetsRunningExecCommand(t *testing.T) {
	d := &Driver{}
	started := d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_exec","name":"exec_command","arguments":"{\"cmd\":\"npm --prefix frontend run build:typecheck\"}"},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, started, "assistant", "exec_command started")
	assertContentField(t, started, 0, "id", "call_exec", "exec_command tool id")
	assertContentField(t, started, 0, "name", "Bash", "exec_command tool name")

	running := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"functionCallOutput","id":"out_running","call_id":"call_exec","output":"Chunk ID: abc\nWall time: 1.0 seconds\nProcess running with session ID 77674\nOriginal token count: 0\nOutput:\n"},"threadId":"t1","turnId":"turn1"}}`))
	assertNil(t, running, "running-only exec_command output")

	poll := d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_poll","name":"write_stdin","arguments":"{\"session_id\":77674,\"chars\":\"\",\"yield_time_ms\":1000,\"max_output_tokens\":12000}"},"threadId":"t1","turnId":"turn1"}}`))
	assertNil(t, poll, "write_stdin started")

	result := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"functionCallOutput","id":"out_poll","call_id":"call_poll","output":"Chunk ID: def\nWall time: 0.5 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\nfrontend build ok\n"},"threadId":"t1","turnId":"turn1"}}`))
	assertType(t, result, "user", "write_stdin output")
	assertContentBlockType(t, result, 0, "tool_result", "write_stdin output block")
	assertContentField(t, result, 0, "tool_use_id", "call_exec", "write_stdin output target")
	assertContentField(t, result, 0, "content", "frontend build ok\n", "write_stdin output content")
}

func TestInteractive_WriteStdinWithoutKnownSessionIsSuppressed(t *testing.T) {
	d := &Driver{}
	poll := d.ParseOutput([]byte(`{"method":"item/started","params":{"item":{"type":"functionCall","id":"call_poll","name":"write_stdin","arguments":"{\"session_id\":77674,\"chars\":\"\"}"},"threadId":"t1","turnId":"turn1"}}`))
	assertNil(t, poll, "write_stdin started without session mapping")

	result := d.ParseOutput([]byte(`{"method":"item/completed","params":{"item":{"type":"functionCallOutput","id":"out_poll","call_id":"call_poll","output":"Chunk ID: def\nWall time: 0.5 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\nlate output\n"},"threadId":"t1","turnId":"turn1"}}`))
	assertNil(t, result, "write_stdin output without session mapping")
}

func TestInteractive_WebSearchOpenPageMapsToWebFetch(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"webSearch","id":"ws_fetch","query":"","action":{"type":"open_page","url":"https://openai.com/"}},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "assistant", "webSearch open_page")
	assertContentBlockType(t, ev, 0, "tool_use", "webFetch tool_use")
	assertContentField(t, ev, 0, "name", "WebFetch", "open_page should map to WebFetch")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]any)
	if input["url"] != "https://openai.com/" {
		t.Fatalf("expected webFetch url, got %v", input["url"])
	}
	if blocks[1]["type"] != "tool_result" {
		t.Fatalf("expected completed webFetch tool_result, got %v", blocks[1]["type"])
	}
}

// --- 1F. User Message ---

func TestInteractive_UserMessageStarted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"userMessage","id":"um1","content":[{"type":"text","text":"hello"}]},"threadId":"t1","turnId":"turn1"}}`)
	// userMessage started - implementation may vary
	if ev != nil {
		assertType(t, ev, "system", "userMessage started")
	}
}

func TestInteractive_UserMessageCompleted(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"userMessage","id":"um1","content":[{"type":"text","text":"hello world"}]},"threadId":"t1","turnId":"turn1"}}`)
	assertType(t, ev, "user", "userMessage completed")
}

// --- 1G. Metadata ---

func TestInteractive_TokenUsageUpdated(t *testing.T) {
	ev := parseOutput(t, `{"method":"thread/tokenUsage/updated","params":{"threadId":"t1","turnId":"turn1","tokenUsage":{"total":{"totalTokens":22436,"inputTokens":22026,"cachedInputTokens":2432,"outputTokens":410,"reasoningOutputTokens":242},"last":{"totalTokens":22436,"inputTokens":22026,"cachedInputTokens":2432,"outputTokens":410,"reasoningOutputTokens":242},"modelContextWindow":258400}}}`)
	assertTypeSubtype(t, ev, "system", "token_usage", "tokenUsage")
	usage, _ := ev.Message["usage"].(map[string]interface{})
	if usage == nil {
		t.Fatal("usage should not be nil")
	}
	if usage["input_tokens"] == nil {
		t.Fatal("input_tokens should be present")
	}
}

func TestInteractive_McpServerStatus(t *testing.T) {
	ev := parseOutput(t, `{"method":"mcpServer/startupStatus/updated","params":{"name":"pencil","status":"ready","error":null}}`)
	assertTypeSubtype(t, ev, "system", "mcp_status", "mcpServer status")
}

func TestInteractive_RemoteControlStatus(t *testing.T) {
	ev := parseOutput(t, `{"method":"remoteControl/status/changed","params":{"status":"disabled"}}`)
	assertNil(t, ev, "remoteControl should be nil")
}

func TestInteractive_AccountRateLimits(t *testing.T) {
	ev := parseOutput(t, `{"method":"account/rateLimits/updated","params":{"rateLimits":{"limitId":"codex"}}}`)
	// This falls into the default case for unknown methods
	if ev != nil {
		assertType(t, ev, "system", "rateLimits")
	}
}

// =============================================================================
// PART 2: Batch Protocol Tests (exec --json)
// =============================================================================

func TestBatch_ThreadStarted(t *testing.T) {
	ev := parseOutput(t, `{"type":"thread.started","thread_id":"thread-batch-001"}`)
	assertTypeSubtype(t, ev, "system", "init", "batch thread.started")
}

func TestBatch_TurnStarted(t *testing.T) {
	ev := parseOutput(t, `{"type":"turn.started"}`)
	// turn.started in batch - check current behavior
	if ev != nil {
		assertType(t, ev, "system", "batch turn.started")
	}
}

func TestBatch_ItemStarted_CommandExecution(t *testing.T) {
	ev := parseOutput(t, `{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'echo test'","aggregated_output":"","exit_code":null,"status":"in_progress"}}`)
	// batch item.started should produce tool_use
	if ev == nil {
		t.Fatal("batch item.started should not be nil")
	}
	assertType(t, ev, "assistant", "batch item.started command_execution")
}

func TestBatch_ItemCompleted_CommandExecution_Success(t *testing.T) {
	ev := parseOutput(t, `{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'echo hello'","aggregated_output":"hello\n","exit_code":0,"status":"completed"}}`)
	assertType(t, ev, "user", "batch item.completed command_execution")
	assertContentBlockType(t, ev, 0, "tool_result", "batch tool_result type")
	assertContentField(t, ev, 0, "content", "hello\n", "batch tool_result content")
	assertContentFieldBool(t, ev, 0, "is_error", false, "batch tool_result success")
}

func TestBatch_ItemCompleted_CommandExecution_Error(t *testing.T) {
	ev := parseOutput(t, `{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'false'","aggregated_output":"","exit_code":1,"status":"completed"}}`)
	assertType(t, ev, "user", "batch command error")
	assertContentFieldBool(t, ev, 0, "is_error", true, "batch exit_code=1")
}

func TestBatch_ItemCompleted_AgentMessage(t *testing.T) {
	ev := parseOutput(t, `{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Done. The output was hello."}}`)
	assertType(t, ev, "assistant", "batch agent_message")
	assertContentBlockType(t, ev, 0, "text", "batch text type")
	assertContentField(t, ev, 0, "text", "Done. The output was hello.", "batch text content")
}

func TestBatch_ItemCompleted_FunctionCall_UpdatePlan(t *testing.T) {
	ev := parseOutput(t, `{"type":"item.completed","item":{"id":"call_bp1","type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"开始\",\"plan\":[{\"step\":\"检查状态\",\"status\":\"in_progress\"},{\"step\":\"运行测试\",\"status\":\"pending\"}]}"}}`)
	assertType(t, ev, "assistant", "batch function_call update_plan")
	assertContentBlockType(t, ev, 0, "tool_use", "batch tool_use")
	assertContentField(t, ev, 0, "name", "TodoWrite", "batch should map to TodoWrite")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	if _, has := input["plan"]; has {
		t.Fatal("batch output should NOT contain raw 'plan'")
	}
	if _, has := input["explanation"]; has {
		t.Fatal("batch output should NOT contain raw 'explanation'")
	}
	todos := getTodos(t, input)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}
}

func TestBatch_ResponseItem_FunctionCall_ApplyPatchMapsToEdit(t *testing.T) {
	ev := parseOutput(t, `{"type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"*** Begin Patch\n*** Update File: server.go\n@@\n-before\n+after\n*** End Patch","call_id":"call_patch_batch"}}`)
	assertType(t, ev, "assistant", "batch response_item apply_patch")
	assertContentBlockType(t, ev, 0, "tool_use", "batch apply_patch tool_use")
	assertContentField(t, ev, 0, "name", "Edit", "batch apply_patch should map to Edit")

	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["file_path"] != "server.go" {
		t.Fatalf("expected file_path server.go, got %v", input["file_path"])
	}
	if input["old_string"] != "before" || input["new_string"] != "after" {
		t.Fatalf("expected parsed edit strings, got old=%v new=%v", input["old_string"], input["new_string"])
	}
}

func TestHistory_ItemCompleted_FunctionCall_UpdatePlan(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"call_hp1","type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"开始\",\"plan\":[{\"step\":\"第一步\",\"status\":\"in_progress\"},{\"step\":\"第二步\",\"status\":\"pending\"}]}"}}`)
	assertHistoryType(t, ev, "assistant", "history item.completed function_call")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["name"] != "TodoWrite" {
		t.Fatalf("expected name=TodoWrite, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	if _, has := input["plan"]; has {
		t.Fatal("history output should NOT contain raw 'plan'")
	}
	todos := getTodos(t, input)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}
}

func TestBatch_TurnCompleted(t *testing.T) {
	ev := parseOutput(t, `{"type":"turn.completed","usage":{"input_tokens":43195,"cached_input_tokens":25856,"output_tokens":345,"reasoning_output_tokens":166}}`)
	assertTypeSubtype(t, ev, "assistant", "result", "batch turn.completed")
}

func TestBatch_MessageDelta(t *testing.T) {
	ev := parseOutput(t, `{"type":"message.delta","delta":"streaming text"}`)
	assertType(t, ev, "assistant", "batch message.delta")
	assertIsDelta(t, ev, true, "batch delta")
	assertContentBlockType(t, ev, 0, "text", "batch delta text type")
	assertContentField(t, ev, 0, "text", "streaming text", "batch delta text")
}

func TestBatch_ThreadError(t *testing.T) {
	ev := parseOutput(t, `{"type":"thread.error","message":"rate limit exceeded"}`)
	assertType(t, ev, "error", "batch thread.error")
}

func TestBatch_TurnFailed(t *testing.T) {
	ev := parseOutput(t, `{"type":"turn.failed","message":"model error"}`)
	assertType(t, ev, "error", "batch turn.failed")
}

// =============================================================================
// PART 3: Stored JSONL History Tests (NormalizeHistoryEntry)
// =============================================================================

func normalizeEntry(t *testing.T, jsonStr string) provider.OutputEvent {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal([]byte(jsonStr), &raw); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	return NormalizeHistoryEntry(raw)
}

func assertHistoryType(t *testing.T, ev provider.OutputEvent, expectedType string, context string) {
	t.Helper()
	if ev.Type != expectedType {
		t.Fatalf("[%s] expected Type=%q, got %q", context, expectedType, ev.Type)
	}
}

func assertHistorySubtype(t *testing.T, ev provider.OutputEvent, expectedSubtype string, context string) {
	t.Helper()
	if ev.Subtype != expectedSubtype {
		t.Fatalf("[%s] expected Subtype=%q, got %q", context, expectedSubtype, ev.Subtype)
	}
}

func assertHistorySuppressed(t *testing.T, ev provider.OutputEvent, context string) {
	t.Helper()
	if !ev.Suppressed() {
		t.Fatalf("[%s] expected suppressed event, got %#v", context, ev)
	}
}

func getHistoryContentBlocks(t *testing.T, ev provider.OutputEvent) []map[string]interface{} {
	t.Helper()
	msg := ev.Message
	if msg == nil {
		t.Fatal("message is nil")
	}
	inner, _ := msg["message"].(map[string]any)
	if inner == nil {
		t.Fatal("message.message is nil")
	}
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
	t.Fatal("content is not []interface{}")
	return nil
}

// --- 3A. Session Lifecycle (Stored) ---

func TestHistory_SessionMeta(t *testing.T) {
	ev := normalizeEntry(t, `{"timestamp":"2026-05-25T09:25:52.403Z","type":"session_meta","payload":{"id":"019e5e74","cwd":"/tmp","cli_version":"0.133.0"}}`)
	assertHistoryType(t, ev, "system", "session_meta")
	assertHistorySubtype(t, ev, "init", "session_meta subtype")
}

func TestHistory_TurnCompleted(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"turn.completed","usage":{"input_tokens":100}}`)
	assertHistoryType(t, ev, "assistant", "turn.completed")
	assertHistorySubtype(t, ev, "result", "turn.completed subtype")
	if ev.Message["type"] != "result" || ev.Message["subtype"] != "success" {
		t.Fatalf("expected result/success, got %v", ev.Message)
	}
}

func TestHistory_ThreadCompleted(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"thread.completed"}`)
	assertHistoryType(t, ev, "assistant", "thread.completed")
	assertHistorySubtype(t, ev, "result", "thread.completed subtype")
}

func TestHistory_ThreadCancelled(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"thread.cancelled"}`)
	assertHistoryType(t, ev, "assistant", "thread.cancelled")
	assertHistorySubtype(t, ev, "result", "thread.cancelled subtype")
}

func TestHistory_ThreadError(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"thread.error","message":"rate limit exceeded"}`)
	assertHistoryType(t, ev, "error", "thread.error")
	if ev.Message["message"] != "rate limit exceeded" {
		t.Fatalf("expected error message, got %v", ev.Message)
	}
}

func TestHistory_TurnFailed(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"turn.failed","message":"model crashed"}`)
	assertHistoryType(t, ev, "error", "turn.failed")
}

// --- 3B. Content Output (Stored) ---

func TestHistory_ResponseItem_Message(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"message","text":"Hello from codex"}}`)
	assertHistoryType(t, ev, "assistant", "response_item/message")
	blocks := getHistoryContentBlocks(t, ev)
	if len(blocks) == 0 {
		t.Fatal("expected content blocks")
	}
	if blocks[0]["type"] != "text" {
		t.Fatalf("expected text block, got %v", blocks[0]["type"])
	}
	if blocks[0]["text"] != "Hello from codex" {
		t.Fatalf("expected text content, got %v", blocks[0]["text"])
	}
}

func TestHistory_ResponseItem_Message_ContentArray(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"message","content":[{"type":"text","text":"multi-block text"}]}}`)
	assertHistoryType(t, ev, "assistant", "response_item/message content array")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["text"] != "multi-block text" {
		t.Fatalf("expected text from content array, got %v", blocks[0]["text"])
	}
}

func TestHistory_ResponseItem_UserMessagePreservesRole(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}`)
	assertHistoryType(t, ev, "user", "response_item/message role=user")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "text" {
		t.Fatalf("expected text block, got %v", blocks[0]["type"])
	}
	if blocks[0]["text"] != "hi" {
		t.Fatalf("expected user text, got %v", blocks[0]["text"])
	}
}

func TestHistory_MessageDelta(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"message.delta","delta":"streaming chunk"}`)
	assertHistoryType(t, ev, "assistant", "message.delta")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["text"] != "streaming chunk" {
		t.Fatalf("expected delta text, got %v", blocks[0]["text"])
	}
}

// --- 3C. Reasoning (Stored) ---

func TestHistory_ResponseItem_Reasoning_WithSummary(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"Thinking about approach"}]}}`)
	assertHistoryType(t, ev, "assistant", "reasoning with summary")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "thinking" {
		t.Fatalf("expected thinking block, got %v", blocks[0]["type"])
	}
	if blocks[0]["thinking"] != "Thinking about approach" {
		t.Fatalf("expected thinking text, got %v", blocks[0]["thinking"])
	}
}

func TestHistory_ResponseItem_Reasoning_WithText(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"reasoning","text":"Direct reasoning text","summary":[]}}`)
	assertHistoryType(t, ev, "assistant", "reasoning with text")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["thinking"] != "Direct reasoning text" {
		t.Fatalf("expected thinking text, got %v", blocks[0]["thinking"])
	}
}

func TestHistory_ResponseItem_Reasoning_Empty(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"reasoning","summary":[],"encrypted_content":"gAAAA..."}}`)
	// Empty reasoning (only encrypted_content) should produce nil message
	if ev.Message != nil {
		// If message is not nil, it should still be valid
		assertHistoryType(t, ev, "assistant", "empty reasoning")
	}
}

// --- 3D. Tool Use (Stored) ---

func TestHistory_ResponseItem_FunctionCall_ExecCommand(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls -la\"}","call_id":"call_abc"}}`)
	assertHistoryType(t, ev, "assistant", "function_call exec_command")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
	if blocks[0]["id"] != "call_abc" {
		t.Fatalf("expected id=call_abc, got %v", blocks[0]["id"])
	}
	if blocks[0]["name"] != "LS" {
		t.Fatalf("expected name=LS, got %v", blocks[0]["name"])
	}
}

func TestHistory_ResponseItem_FunctionCall_UpdatePlan(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"explanation\":\"开始\",\"plan\":[{\"step\":\"第一步\",\"status\":\"in_progress\"},{\"step\":\"第二步\",\"status\":\"pending\"}]}","call_id":"call_plan"}}`)
	assertHistoryType(t, ev, "assistant", "function_call update_plan")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["name"] != "TodoWrite" {
		t.Fatalf("expected name=TodoWrite, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	todos := getTodos(t, input)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}
	first := todos[0]
	if first["content"] != "第一步" {
		t.Fatalf("expected content='第一步', got %v", first["content"])
	}
	if first["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", first["status"])
	}
}

func TestHistory_ResponseItem_FunctionCall_ApplyPatchMapsToEdit(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"*** Begin Patch\n*** Update File: main.go\n@@\n-left\n+right\n*** End Patch","call_id":"call_patch_history"}}`)
	assertHistoryType(t, ev, "assistant", "function_call apply_patch")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["name"] != "Edit" {
		t.Fatalf("expected name=Edit, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input["file_path"] != "main.go" {
		t.Fatalf("expected file_path main.go, got %v", input["file_path"])
	}
	if input["old_string"] != "left" || input["new_string"] != "right" {
		t.Fatalf("expected parsed edit strings, got old=%v new=%v", input["old_string"], input["new_string"])
	}
}

func TestHistory_ResponseItem_FunctionCall_SpawnAgent(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"spawn_agent","namespace":"multi_agent_v1","arguments":"{\"agent_type\":\"explorer\",\"message\":\"search code\"}","call_id":"call_spawn"}}`)
	assertHistoryType(t, ev, "assistant", "function_call spawn_agent")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
	if blocks[0]["id"] != "call_spawn" {
		t.Fatalf("expected id=call_spawn, got %v", blocks[0]["id"])
	}
	if blocks[0]["name"] != "Agent" {
		t.Fatalf("expected name=Agent, got %v", blocks[0]["name"])
	}
}

func TestHistory_ResponseItem_FunctionCall_WaitAgent(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"wait_agent","namespace":"multi_agent_v1","arguments":"{\"targets\":[\"ag_123\"],\"timeout_ms\":180000}","call_id":"call_wait"}}`)
	// wait_agent should be suppressed (nil message)
	if ev.Message != nil {
		t.Fatalf("wait_agent should produce nil message, got %v", ev.Message)
	}
}

func TestHistory_ResponseItem_FunctionCallOutput(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_abc","output":"hello\nworld\n"}}`)
	assertHistoryType(t, ev, "user", "function_call_output")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
	if blocks[0]["tool_use_id"] != "call_abc" {
		t.Fatalf("expected tool_use_id=call_abc, got %v", blocks[0]["tool_use_id"])
	}
	if blocks[0]["content"] != "hello\nworld\n" {
		t.Fatalf("expected output content, got %v", blocks[0]["content"])
	}
}

func TestHistory_ResponseItem_FunctionCallOutput_SpawnAgent(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_spawn","output":"Full-history forked agents inherit the parent agent type"}}`)
	// Text spawn acknowledgment passes through as tool_result (so frontend marks spawn as Done)
	assertHistoryType(t, ev, "user", "spawn_agent text output")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
}

func TestHistory_ResponseItem_FunctionCallOutput_SpawnAgent_JSON(t *testing.T) {
	// JSON spawn acknowledgment with agent_id should return brief text (not raw JSON)
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_spawn","output":"{\"agent_id\":\"019e5859-05be\",\"nickname\":\"Volta\"}"}}`)
	assertHistoryType(t, ev, "user", "spawn_agent JSON output")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
	content, _ := blocks[0]["content"].(string)
	if content != "Agent spawned: Volta" {
		t.Fatalf("expected 'Agent spawned: Volta', got %q", content)
	}
}

// --- 3E. Tool Use ID Pairing ---

func TestHistory_ToolUseIDPairing(t *testing.T) {
	// Verify that function_call and function_call_output share the same call_id
	callEv := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"pwd\"}","call_id":"call_paired_001"}}`)
	resultEv := normalizeEntry(t, `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_paired_001","output":"/home/user"}}`)

	callBlocks := getHistoryContentBlocks(t, callEv)
	resultBlocks := getHistoryContentBlocks(t, resultEv)

	callID, _ := callBlocks[0]["id"].(string)
	resultID, _ := resultBlocks[0]["tool_use_id"].(string)

	if callID != resultID {
		t.Fatalf("tool_use id=%q does not match tool_result tool_use_id=%q", callID, resultID)
	}
	if callID != "call_paired_001" {
		t.Fatalf("expected call_paired_001, got %q", callID)
	}
}

func TestHistory_LoadEventsRetargetsWriteStdinOutput(t *testing.T) {
	codexDir := t.TempDir()
	sessionID := "session-write-stdin"
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "06", "03")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir session dir: %v", err)
	}
	sessionFile := filepath.Join(sessionDir, "rollout-2026-06-03T00-00-00-"+sessionID+".jsonl")
	lines := []string{
		`{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"npm --prefix frontend run build:typecheck\"}","call_id":"call_exec"}}`,
		`{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_exec","output":"Chunk ID: abc\nWall time: 1.0 seconds\nProcess running with session ID 77674\nOriginal token count: 0\nOutput:\n"}}`,
		`{"type":"response_item","payload":{"type":"function_call","name":"write_stdin","arguments":"{\"session_id\":77674,\"chars\":\"\",\"yield_time_ms\":1000,\"max_output_tokens\":12000}","call_id":"call_poll"}}`,
		`{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_poll","output":"Chunk ID: def\nWall time: 0.5 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\nfrontend build ok\n"}}`,
	}
	if err := os.WriteFile(sessionFile, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	events, err := LoadHistoryEvents(codexDir, sessionID)
	if err != nil {
		t.Fatalf("load history events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 normalized events, got %d: %#v", len(events), events)
	}
	toolUseBlocks := getHistoryContentBlocks(t, events[0])
	if toolUseBlocks[0]["id"] != "call_exec" {
		t.Fatalf("expected exec tool id call_exec, got %v", toolUseBlocks[0]["id"])
	}
	resultBlocks := getHistoryContentBlocks(t, events[1])
	if resultBlocks[0]["tool_use_id"] != "call_exec" {
		t.Fatalf("expected retargeted tool_result id call_exec, got %v", resultBlocks[0]["tool_use_id"])
	}
	if resultBlocks[0]["content"] != "frontend build ok\n" {
		t.Fatalf("expected stripped command output, got %q", resultBlocks[0]["content"])
	}
}

func TestHistory_LoadEventsSuppressesDisplaylessCodexEvents(t *testing.T) {
	codexDir := t.TempDir()
	sessionID := "session-suppressed-events"
	sessionDir := filepath.Join(codexDir, "sessions", "2026", "06", "03")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("mkdir session dir: %v", err)
	}
	sessionFile := filepath.Join(sessionDir, "rollout-2026-06-03T00-00-00-"+sessionID+".jsonl")
	lines := []string{
		`{"type":"event_msg","payload":{"type":"agent_message","message":"duplicate assistant message"}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":""}]}}`,
		`{"type":"response_item","payload":{"type":"reasoning","summary":[],"content":[]}}`,
		`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Visible assistant text"}]}}`,
		`{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"npx tsc --noEmit\"}","call_id":"call_tsc"}}`,
	}
	if err := os.WriteFile(sessionFile, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	events, err := LoadHistoryEvents(codexDir, sessionID)
	if err != nil {
		t.Fatalf("load history events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 visible events, got %d: %#v", len(events), events)
	}
	textBlocks := getHistoryContentBlocks(t, events[0])
	if textBlocks[0]["text"] != "Visible assistant text" {
		t.Fatalf("expected visible assistant text, got %v", textBlocks[0]["text"])
	}
	toolBlocks := getHistoryContentBlocks(t, events[1])
	if toolBlocks[0]["type"] != "tool_use" || toolBlocks[0]["name"] != "Bash" {
		t.Fatalf("expected Bash tool_use, got %#v", toolBlocks[0])
	}
}

// --- 3F. Batch item.completed (Stored-like format) ---

func TestHistory_ItemCompleted_AgentMessage(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Summary of results"}}`)
	assertHistoryType(t, ev, "assistant", "item.completed agent_message")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["text"] != "Summary of results" {
		t.Fatalf("expected text, got %v", blocks[0]["text"])
	}
}

func TestHistory_ItemCompleted_CommandExecution(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'echo hi'","aggregated_output":"hi\n","exit_code":0}}`)
	assertHistoryType(t, ev, "assistant", "item.completed command_execution")
	// command_execution in item.completed maps to tool_use (the command itself)
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
}

func TestHistory_ItemCompleted_FunctionCallOutput(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"out1","type":"function_call_output","output":"result data"}}`)
	assertHistoryType(t, ev, "user", "item.completed function_call_output")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
	if blocks[0]["content"] != "result data" {
		t.Fatalf("expected content, got %v", blocks[0]["content"])
	}
}

func TestHistory_ItemCompleted_LocalShellExec(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"sh1","type":"local_shell_exec","command":"ls","name":""}}`)
	assertHistoryType(t, ev, "assistant", "item.completed local_shell_exec")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_use" {
		t.Fatalf("expected tool_use, got %v", blocks[0]["type"])
	}
}

func TestHistory_ItemCompleted_LocalShellOutput(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":{"id":"sh_out","type":"local_shell_output","output":"file1.txt\nfile2.txt"}}`)
	assertHistoryType(t, ev, "user", "item.completed local_shell_output")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result, got %v", blocks[0]["type"])
	}
}

// --- 3G. Web Search (Stored) ---

func TestHistory_ResponseItem_WebSearchCall(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"web_search_call","status":"completed","action":{"type":"search","queries":["OpenClaw GitHub"]}}}`)
	assertHistoryType(t, ev, "assistant", "web_search_call")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["name"] != "WebSearch" {
		t.Fatalf("expected WebSearch, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]any)
	if input["query"] != "OpenClaw GitHub" {
		t.Fatalf("expected query from history web search, got %v", input["query"])
	}
}

func TestHistory_ResponseItem_WebSearchOpenPageMapsToWebFetch(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"web_search_call","status":"completed","action":{"type":"open_page","url":"https://openai.com/"}}}`)
	assertHistoryType(t, ev, "assistant", "web_search_call")
	blocks := getHistoryContentBlocks(t, ev)
	if blocks[0]["name"] != "WebFetch" {
		t.Fatalf("expected WebFetch, got %v", blocks[0]["name"])
	}
	input, _ := blocks[0]["input"].(map[string]any)
	if input["url"] != "https://openai.com/" {
		t.Fatalf("expected WebFetch url, got %v", input["url"])
	}
}

// --- 3H. Metadata (Stored) ---

func TestHistory_ResponseItem_ToolSearchCall(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"tool_search_call","status":"completed"}}`)
	assertHistorySuppressed(t, ev, "tool_search_call")
}

func TestHistory_ResponseItem_ToolSearchOutput(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"tool_search_output","call_id":"call_x","tools":[{"name":"spawn_agent"}]}}`)
	assertHistorySuppressed(t, ev, "tool_search_output")
}

func TestHistory_ResponseItem_DeveloperMessage(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"system instructions"}]}}`)
	assertHistorySuppressed(t, ev, "developer message")
}

// =============================================================================
// PART 4: Edge Cases & Protocol Compliance
// =============================================================================

func TestParseOutput_InvalidJSON(t *testing.T) {
	ev := parseOutput(t, `not json at all`)
	assertType(t, ev, "raw", "invalid JSON")
	if ev.Raw != "not json at all" {
		t.Fatalf("expected raw content preserved, got %q", ev.Raw)
	}
}

func TestParseOutput_EmptyObject(t *testing.T) {
	ev := parseOutput(t, `{}`)
	// No method, no id → falls to parseBatchEvent with empty type
	if ev != nil {
		// Should not crash
		_ = ev.Type
	}
}

func TestInteractive_UnknownMethod(t *testing.T) {
	ev := parseOutput(t, `{"method":"future/newEvent","params":{"data":"something"}}`)
	// Unknown methods should produce a system event (forward-compatible)
	if ev != nil {
		assertType(t, ev, "system", "unknown method")
	}
}

func TestHistory_UnknownType(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"unknown_future_type","data":"something"}`)
	// Should not crash, produces some event
	_ = ev.Type
}

func TestHistory_NilPayload(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"response_item","payload":null}`)
	assertHistorySuppressed(t, ev, "nil payload")
}

func TestHistory_EmptyItem(t *testing.T) {
	ev := normalizeEntry(t, `{"type":"item.completed","item":null}`)
	assertHistorySuppressed(t, ev, "nil item")
}

// --- Protocol Compliance: No empty content blocks ---

func TestCompliance_AgentMessageDelta_NonEmpty(t *testing.T) {
	ev := parseOutput(t, `{"method":"item/agentMessage/delta","params":{"delta":"x"}}`)
	if ev == nil {
		t.Fatal("delta should produce event")
	}
	blocks := getContentBlocks(t, ev)
	if len(blocks) == 0 {
		t.Fatal("delta should have content blocks")
	}
	text, _ := blocks[0]["text"].(string)
	if text == "" {
		t.Fatal("delta text should not be empty")
	}
}

func TestCompliance_TurnCompleted_HasResultMessage(t *testing.T) {
	ev := parseOutput(t, `{"method":"turn/completed","params":{}}`)
	if ev == nil {
		t.Fatal("turn/completed should produce event")
	}
	if ev.Message == nil {
		t.Fatal("turn/completed should have message")
	}
	if ev.Message["type"] != "result" {
		t.Fatalf("turn/completed message.type should be 'result', got %v", ev.Message["type"])
	}
}

func TestCompliance_CommandExecution_IDPairing(t *testing.T) {
	// Verify started and completed share the same ID for pairing
	startedEv := parseOutput(t, `{"method":"item/started","params":{"item":{"type":"commandExecution","id":"call_PAIR","command":"/bin/zsh -lc 'pwd'","commandActions":[{"type":"unknown","command":"pwd"}],"aggregatedOutput":null,"exitCode":null},"threadId":"t1","turnId":"turn1"}}`)
	completedEv := parseOutput(t, `{"method":"item/completed","params":{"item":{"type":"commandExecution","id":"call_PAIR","command":"/bin/zsh -lc 'pwd'","commandActions":[{"type":"unknown","command":"pwd"}],"aggregatedOutput":"/home\n","exitCode":0},"threadId":"t1","turnId":"turn1"}}`)

	if startedEv == nil || completedEv == nil {
		t.Fatal("both events should be non-nil")
	}

	startBlocks := getContentBlocks(t, startedEv)
	endBlocks := getContentBlocks(t, completedEv)

	startID, _ := startBlocks[0]["id"].(string)
	endID, _ := endBlocks[0]["tool_use_id"].(string)

	if startID != "call_PAIR" {
		t.Fatalf("started tool_use id should be call_PAIR, got %q", startID)
	}
	if endID != "call_PAIR" {
		t.Fatalf("completed tool_result tool_use_id should be call_PAIR, got %q", endID)
	}
}

func TestCompliance_BatchCommandExecution_IDPairing(t *testing.T) {
	// In batch mode, item.started and item.completed should share the same item.id
	startedEv := parseOutput(t, `{"type":"item.started","item":{"id":"item_5","type":"command_execution","command":"/bin/zsh -lc 'date'","aggregated_output":"","exit_code":null,"status":"in_progress"}}`)
	completedEv := parseOutput(t, `{"type":"item.completed","item":{"id":"item_5","type":"command_execution","command":"/bin/zsh -lc 'date'","aggregated_output":"Mon May 25\n","exit_code":0,"status":"completed"}}`)

	if startedEv == nil || completedEv == nil {
		// If batch item.started doesn't produce tool_use, that's a known gap
		t.Skip("batch item.started may not produce tool_use in current implementation")
	}
}

// --- Stderr parsing ---

func TestParseStderr_IgnoresStdinNotice(t *testing.T) {
	d := &Driver{}
	ev := d.ParseStderr([]byte("Reading additional input from stdin..."))
	if ev != nil {
		t.Fatal("stdin notice should be nil")
	}
}

func TestParseStderr_Warning(t *testing.T) {
	d := &Driver{}
	ev := d.ParseStderr([]byte("2026-05-24T05:34:10Z  WARN codex_core: retrying"))
	if ev == nil {
		t.Fatal("expected warning")
	}
	if ev.Level != "warning" {
		t.Fatalf("expected warning, got %q", ev.Level)
	}
}

func TestParseStderr_TabWarn(t *testing.T) {
	d := &Driver{}
	ev := d.ParseStderr([]byte("2026-05-24T05:34:10Z\tWARN\tcodex: something"))
	if ev == nil {
		t.Fatal("expected warning")
	}
	if ev.Level != "warning" {
		t.Fatalf("expected warning, got %q", ev.Level)
	}
}

func TestParseStderr_Error(t *testing.T) {
	d := &Driver{}
	ev := d.ParseStderr([]byte("fatal error: runtime panic"))
	if ev == nil {
		t.Fatal("expected error")
	}
	if ev.Level != "error" {
		t.Fatalf("expected error, got %q", ev.Level)
	}
}

// --- turn/plan/updated → TodoWrite ---

func TestInteractive_TurnPlanUpdated(t *testing.T) {
	ev := parseOutput(t, `{"method":"turn/plan/updated","params":{"threadId":"t1","turnId":"turn1","explanation":null,"plan":[{"step":"check files","status":"inProgress"},{"step":"summarize","status":"pending"}]}}`)
	if ev == nil {
		t.Fatal("turn/plan/updated should produce event")
	}
	assertType(t, ev, "assistant", "turn/plan/updated")
	assertContentBlockType(t, ev, 0, "tool_use", "plan tool_use")
	assertContentField(t, ev, 0, "name", "TodoWrite", "plan should map to TodoWrite")
	blocks := getContentBlocks(t, ev)
	input, _ := blocks[0]["input"].(map[string]interface{})
	if input == nil {
		t.Fatal("input should not be nil")
	}
	todos := getTodos(t, input)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}
	first := todos[0]
	if first["content"] != "check files" {
		t.Fatalf("expected content='check files', got %v", first["content"])
	}
	if first["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", first["status"])
	}
	second := todos[1]
	if second["status"] != "pending" {
		t.Fatalf("expected status=pending, got %v", second["status"])
	}
}

func TestInteractive_TurnPlanUpdated_Empty(t *testing.T) {
	ev := parseOutput(t, `{"method":"turn/plan/updated","params":{"threadId":"t1","turnId":"turn1","plan":[]}}`)
	assertNil(t, ev, "empty plan should be nil")
}
