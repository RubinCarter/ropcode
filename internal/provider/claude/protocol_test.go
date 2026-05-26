package claude

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"ropcode/internal/provider"
)

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
	start := 0
	for i, b := range data {
		if b == '\n' {
			if i > start {
				var obj map[string]any
				if json.Unmarshal(data[start:i], &obj) == nil {
					results = append(results, obj)
				}
			}
			start = i + 1
		}
	}
	if start < len(data) {
		var obj map[string]any
		if json.Unmarshal(data[start:], &obj) == nil {
			results = append(results, obj)
		}
	}
	return results
}

func parseOutput(t *testing.T, jsonStr string) *provider.OutputEvent {
	t.Helper()
	d := &Driver{}
	return d.ParseOutput([]byte(jsonStr))
}

func getContentBlocks(t *testing.T, ev *provider.OutputEvent) []map[string]interface{} {
	t.Helper()
	if ev == nil || ev.Message == nil {
		t.Fatal("event or message is nil")
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner != nil {
		if blocks, ok := inner["content"].([]interface{}); ok {
			result := make([]map[string]interface{}, 0, len(blocks))
			for _, b := range blocks {
				if m, ok := b.(map[string]interface{}); ok {
					result = append(result, m)
				}
			}
			return result
		}
	}
	// Claude format: content is directly in message
	if content, ok := msg["content"].([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(content))
		for _, b := range content {
			if m, ok := b.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	t.Fatal("no content blocks found")
	return nil
}

// =============================================================================
// PART 1: Live stdio Protocol Tests (stream-json)
// =============================================================================

func TestLive_SystemInit(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/system__init.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "init" {
		t.Fatalf("expected subtype=init, got %q", ev.Subtype)
	}
	// Verify key fields are preserved
	if ev.Message["session_id"] == nil {
		t.Fatal("session_id should be present")
	}
	if ev.Message["model"] == nil {
		t.Fatal("model should be present")
	}
	if ev.Message["cwd"] == nil {
		t.Fatal("cwd should be present")
	}
}

func TestLive_SystemHookStarted(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/system__hook_started.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "hook_started" {
		t.Fatalf("expected subtype=hook_started, got %q", ev.Subtype)
	}
}

func TestLive_SystemHookResponse(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/system__hook_response.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "hook_response" {
		t.Fatalf("expected subtype=hook_response, got %q", ev.Subtype)
	}
}

func TestLive_AssistantToolUse(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/assistant__tool_use.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	// Verify content has tool_use block
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "tool_use" {
		t.Fatalf("expected tool_use block, got %v", block["type"])
	}
	if block["id"] == nil || block["id"] == "" {
		t.Fatal("tool_use id should be present")
	}
	if block["name"] == nil || block["name"] == "" {
		t.Fatal("tool_use name should be present")
	}
}

func TestLive_AssistantText(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/assistant__text.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "text" {
		t.Fatalf("expected text block, got %v", block["type"])
	}
	text, _ := block["text"].(string)
	if text == "" {
		t.Fatal("text should not be empty")
	}
}

func TestLive_UserToolResult(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/user__tool_result.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "user" {
		t.Fatalf("expected type=user, got %q", ev.Type)
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "tool_result" {
		t.Fatalf("expected tool_result block, got %v", block["type"])
	}
	if block["tool_use_id"] == nil || block["tool_use_id"] == "" {
		t.Fatal("tool_use_id should be present")
	}
}

func TestLive_Result(t *testing.T) {
	raw := loadSample(t, "live/claude_categorized/result.json")
	data, _ := json.Marshal(raw)
	ev := parseOutput(t, string(data))

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	if ev.Subtype != "result" {
		t.Fatalf("expected subtype=result, got %q", ev.Subtype)
	}
	if ev.Message["is_error"] != false {
		t.Fatalf("expected is_error=false, got %v", ev.Message["is_error"])
	}
}

// =============================================================================
// PART 2: Stored JSONL History Tests
// =============================================================================

func TestHistory_AssistantText(t *testing.T) {
	raw := loadSample(t, "claude/assistant__text.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	// Verify content blocks preserved
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "text" {
		t.Fatalf("expected text block, got %v", block["type"])
	}
}

func TestHistory_AssistantThinking(t *testing.T) {
	raw := loadSample(t, "claude/assistant__thinking.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "thinking" {
		t.Fatalf("expected thinking block, got %v", block["type"])
	}
	// thinking text may be empty (redacted) with signature field present
	if block["thinking"] == nil {
		t.Fatal("thinking field should exist (even if empty)")
	}
}

func TestHistory_AssistantToolUse(t *testing.T) {
	raw := loadSample(t, "claude/assistant__tool_use.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "assistant" {
		t.Fatalf("expected type=assistant, got %q", ev.Type)
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "tool_use" {
		t.Fatalf("expected tool_use block, got %v", block["type"])
	}
	if block["id"] == nil || block["id"] == "" {
		t.Fatal("tool_use id should be present")
	}
	if block["name"] == nil || block["name"] == "" {
		t.Fatal("tool_use name should be present")
	}
	if block["input"] == nil {
		t.Fatal("tool_use input should be present")
	}
}

func TestHistory_UserToolResult(t *testing.T) {
	raw := loadSample(t, "claude/user__tool_result.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "user" {
		t.Fatalf("expected type=user, got %q", ev.Type)
	}
	msg := ev.Message
	inner, _ := msg["message"].(map[string]interface{})
	if inner == nil {
		t.Fatal("message.message should exist")
	}
	content, _ := inner["content"].([]interface{})
	if len(content) == 0 {
		t.Fatal("content should not be empty")
	}
	block, _ := content[0].(map[string]interface{})
	if block["type"] != "tool_result" {
		t.Fatalf("expected tool_result block, got %v", block["type"])
	}
	if block["tool_use_id"] == nil || block["tool_use_id"] == "" {
		t.Fatal("tool_use_id should be present")
	}
}

func TestHistory_UserText(t *testing.T) {
	raw := loadSample(t, "claude/user__text.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "user" {
		t.Fatalf("expected type=user, got %q", ev.Type)
	}
}

func TestHistory_SystemApiError(t *testing.T) {
	raw := loadSample(t, "claude/system__api_error.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "api_error" {
		t.Fatalf("expected subtype=api_error, got %q", ev.Subtype)
	}
}

func TestHistory_SystemCompactBoundary(t *testing.T) {
	raw := loadSample(t, "claude/system__compact_boundary.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "compact_boundary" {
		t.Fatalf("expected subtype=compact_boundary, got %q", ev.Subtype)
	}
}

func TestHistory_SystemLocalCommand(t *testing.T) {
	raw := loadSample(t, "claude/system__local_command.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "local_command" {
		t.Fatalf("expected subtype=local_command, got %q", ev.Subtype)
	}
}

func TestHistory_SystemScheduledTaskFire(t *testing.T) {
	raw := loadSample(t, "claude/system__scheduled_task_fire.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "scheduled_task_fire" {
		t.Fatalf("expected subtype=scheduled_task_fire, got %q", ev.Subtype)
	}
}

func TestHistory_SystemTurnDuration(t *testing.T) {
	raw := loadSample(t, "claude/system__turn_duration.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "system" {
		t.Fatalf("expected type=system, got %q", ev.Type)
	}
	if ev.Subtype != "turn_duration" {
		t.Fatalf("expected subtype=turn_duration, got %q", ev.Subtype)
	}
}

func TestHistory_Attachment(t *testing.T) {
	raw := loadSample(t, "claude/attachment.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "attachment" {
		t.Fatalf("expected type=attachment, got %q", ev.Type)
	}
}

func TestHistory_QueueOperation(t *testing.T) {
	raw := loadSample(t, "claude/queue-operation.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "queue-operation" {
		t.Fatalf("expected type=queue-operation, got %q", ev.Type)
	}
}

func TestHistory_LastPrompt(t *testing.T) {
	raw := loadSample(t, "claude/last-prompt.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "last-prompt" {
		t.Fatalf("expected type=last-prompt, got %q", ev.Type)
	}
}

func TestHistory_PermissionMode(t *testing.T) {
	raw := loadSample(t, "claude/permission-mode.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "permission-mode" {
		t.Fatalf("expected type=permission-mode, got %q", ev.Type)
	}
}

func TestHistory_FileHistorySnapshot(t *testing.T) {
	raw := loadSample(t, "claude/file-history-snapshot.json")
	ev := NormalizeHistoryEntry(raw)

	if ev.Type != "file-history-snapshot" {
		t.Fatalf("expected type=file-history-snapshot, got %q", ev.Type)
	}
}

// =============================================================================
// PART 3: Tool Use / Tool Result ID Pairing
// =============================================================================

func TestHistory_ToolUseIDPairing(t *testing.T) {
	toolUseRaw := loadSample(t, "claude/assistant__tool_use.json")
	toolResultRaw := loadSample(t, "claude/user__tool_result.json")

	toolUseEv := NormalizeHistoryEntry(toolUseRaw)
	toolResultEv := NormalizeHistoryEntry(toolResultRaw)

	// Extract tool_use id
	msg1 := toolUseEv.Message
	inner1, _ := msg1["message"].(map[string]interface{})
	content1, _ := inner1["content"].([]interface{})
	block1, _ := content1[0].(map[string]interface{})
	toolUseID, _ := block1["id"].(string)

	// Extract tool_result tool_use_id
	msg2 := toolResultEv.Message
	inner2, _ := msg2["message"].(map[string]interface{})
	content2, _ := inner2["content"].([]interface{})
	block2, _ := content2[0].(map[string]interface{})
	toolResultID, _ := block2["tool_use_id"].(string)

	if toolUseID == "" {
		t.Fatal("tool_use id should not be empty")
	}
	if toolResultID == "" {
		t.Fatal("tool_result tool_use_id should not be empty")
	}
	// In real data these should match (same session, same tool call)
	if toolUseID != toolResultID {
		t.Logf("tool_use.id=%q, tool_result.tool_use_id=%q (may differ if from different calls)", toolUseID, toolResultID)
	}
}

// =============================================================================
// PART 4: End-to-End Live Capture Verification
// =============================================================================

func TestLive_FullSession_AllEventTypes(t *testing.T) {
	lines := loadLiveLines(t, "claude_stdio.jsonl")
	if len(lines) == 0 {
		t.Skip("no live capture data")
	}

	d := &Driver{}
	var hasInit, hasToolUse, hasToolResult, hasText, hasResult bool

	for _, raw := range lines {
		data, _ := json.Marshal(raw)
		ev := d.ParseOutput(data)
		if ev == nil {
			continue
		}
		switch ev.Type {
		case "system":
			if ev.Subtype == "init" {
				hasInit = true
			}
		case "assistant":
			if ev.Subtype == "result" {
				hasResult = true
			} else {
				msg := ev.Message
				inner, _ := msg["message"].(map[string]interface{})
				if inner != nil {
					content, _ := inner["content"].([]interface{})
					for _, c := range content {
						block, _ := c.(map[string]interface{})
						switch block["type"] {
						case "tool_use":
							hasToolUse = true
						case "text":
							hasText = true
						}
					}
				}
			}
		case "user":
			msg := ev.Message
			inner, _ := msg["message"].(map[string]interface{})
			if inner != nil {
				content, _ := inner["content"].([]interface{})
				for _, c := range content {
					block, _ := c.(map[string]interface{})
					if block["type"] == "tool_result" {
						hasToolResult = true
					}
				}
			}
		}
	}

	if !hasInit {
		t.Error("expected system/init event")
	}
	if !hasToolUse {
		t.Error("expected assistant/tool_use event")
	}
	if !hasToolResult {
		t.Error("expected user/tool_result event")
	}
	if !hasText {
		t.Error("expected assistant/text event")
	}
	if !hasResult {
		t.Error("expected result event")
	}
}

// =============================================================================
// PART 5: Edge Cases
// =============================================================================

func TestParseOutput_InvalidJSON(t *testing.T) {
	ev := parseOutput(t, `not json`)
	if ev.Type != "raw" {
		t.Fatalf("expected type=raw, got %q", ev.Type)
	}
	if ev.Raw != "not json" {
		t.Fatalf("expected raw preserved, got %q", ev.Raw)
	}
}

func TestParseOutput_EmptyObject(t *testing.T) {
	ev := parseOutput(t, `{}`)
	if ev == nil {
		t.Fatal("should not be nil")
	}
}

func TestParseOutput_UnknownType(t *testing.T) {
	ev := parseOutput(t, `{"type":"future_event","data":"something"}`)
	if ev.Type != "future_event" {
		t.Fatalf("expected type=future_event, got %q", ev.Type)
	}
}

func TestParseStderr(t *testing.T) {
	d := &Driver{}
	ev := d.ParseStderr([]byte("some error message"))
	if ev == nil {
		t.Fatal("stderr should produce event")
	}
	if ev.Level != "error" {
		t.Fatalf("expected level=error, got %q", ev.Level)
	}
	if ev.Message != "some error message" {
		t.Fatalf("expected message preserved, got %q", ev.Message)
	}
}

func TestHistory_NormalizeEmpty(t *testing.T) {
	ev := NormalizeHistoryEntry(map[string]any{})
	if ev.Type != "assistant" {
		t.Fatalf("empty entry should default to assistant, got %q", ev.Type)
	}
}
