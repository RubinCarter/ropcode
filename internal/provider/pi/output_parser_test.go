package pi

import (
	"testing"
)

func TestParseResponseCapturesProviderSessionID(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"id":"pi-1","type":"response","command":"prompt","success":true,"data":{"sessionId":"provider-pi-1","sessionFile":"C:/tmp/pi.jsonl"}}`))

	if got.Type != "system" || got.Subtype != "response" {
		t.Fatalf("ParseOutput response type = %s/%s, want system/response", got.Type, got.Subtype)
	}
	if got.Message["session_id"] != "provider-pi-1" {
		t.Fatalf("session_id = %#v, want provider-pi-1", got.Message["session_id"])
	}
	if got.Message["session_file"] != "C:/tmp/pi.jsonl" {
		t.Fatalf("session_file = %#v, want C:/tmp/pi.jsonl", got.Message["session_file"])
	}
}

func TestParseMessageUpdateAsAssistantDelta(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_update","delta":"hello"}`))

	if got.Type != "assistant" || !got.IsDelta {
		t.Fatalf("ParseOutput message_update type = %s delta=%t, want assistant delta", got.Type, got.IsDelta)
	}
	if textFromAssistantEvent(t, got.Message) != "hello" {
		t.Fatalf("assistant text = %q, want hello", textFromAssistantEvent(t, got.Message))
	}
}

func TestParseRealMessageUpdateDelta(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hi"},"message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}`))

	if got.Type != "assistant" || !got.IsDelta {
		t.Fatalf("ParseOutput real message_update type = %s delta=%t, want assistant delta", got.Type, got.IsDelta)
	}
	if textFromAssistantEvent(t, got.Message) != "Hi" {
		t.Fatalf("assistant text = %q, want Hi", textFromAssistantEvent(t, got.Message))
	}
}

func TestParseMessageUpdateThinkingDeltaAsMetadata(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"The"},"message":{"role":"assistant","content":[{"type":"thinking","thinking":"The"}]}}`))

	if got.Type != "system" || got.Subtype != "message_update" {
		t.Fatalf("ParseOutput thinking delta type = %s/%s, want system/message_update", got.Type, got.Subtype)
	}
	if got.IsDelta {
		t.Fatalf("thinking delta must not be treated as assistant text")
	}
	if !isHiddenByDefault(got.Message) {
		t.Fatalf("thinking delta metadata should be hidden by default: %#v", got.Message)
	}
}

func TestParseMessageUpdateToolCallDeltaAsMetadata(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","delta":"{\"command\":"},"message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"bash","arguments":{}}]}}`))

	if got.Type != "system" || got.Subtype != "message_update" {
		t.Fatalf("ParseOutput tool call delta type = %s/%s, want system/message_update", got.Type, got.Subtype)
	}
	if got.IsDelta {
		t.Fatalf("tool call delta must not be treated as assistant text")
	}
	if !isHiddenByDefault(got.Message) {
		t.Fatalf("tool call delta metadata should be hidden by default: %#v", got.Message)
	}
}

func TestParseMessageUpdateSnapshotAsMetadata(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"Hi snapshot"}],"usage":{"input":1,"output":2}}}`))

	if got.Type != "system" || got.Subtype != "message_update" {
		t.Fatalf("ParseOutput snapshot update type = %s/%s, want system/message_update", got.Type, got.Subtype)
	}
	if got.IsDelta {
		t.Fatalf("snapshot update must not be treated as a text delta")
	}
}

func TestParseMessageAsAssistantText(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message","content":"hello"}`))

	if got.Type != "assistant" || got.IsDelta {
		t.Fatalf("ParseOutput message type = %s delta=%t, want assistant non-delta", got.Type, got.IsDelta)
	}
	if textFromAssistantEvent(t, got.Message) != "hello" {
		t.Fatalf("assistant text = %q, want hello", textFromAssistantEvent(t, got.Message))
	}
}

func TestParseRealMessageEndAsMetadata(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"plan"},{"type":"text","text":"Hi! How can I help?"}],"usage":{"input":1,"output":2}}}`))

	if got.Type != "system" || got.Subtype != "message_end" {
		t.Fatalf("ParseOutput real message_end type = %s/%s, want system/message_end", got.Type, got.Subtype)
	}
	if got.IsDelta {
		t.Fatalf("message_end snapshot must not be treated as a text delta")
	}
	if !isHiddenByDefault(got.Message) {
		t.Fatalf("message_end metadata should be hidden by default: %#v", got.Message)
	}
}

func TestParseAgentStartAsSystemMetadata(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"agent_start"}`))

	if got.Type != "system" || got.Subtype != "agent_start" {
		t.Fatalf("ParseOutput agent_start type = %s/%s, want system/agent_start", got.Type, got.Subtype)
	}
}

func TestParseAgentEndAsResult(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"agent_end","success":true}`))

	if got.Type != "assistant" || got.Subtype != "result" {
		t.Fatalf("ParseOutput agent_end type = %s/%s, want assistant/result", got.Type, got.Subtype)
	}
	if got.Message["subtype"] != "success" {
		t.Fatalf("result subtype = %#v, want success", got.Message["subtype"])
	}
}

func TestParseAgentEndErrorPreservesErrorMessage(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"agent_end","messages":[{"role":"assistant","stopReason":"error","errorMessage":"Request timed out."}]}`))

	if got.Type != "assistant" || got.Subtype != "result" {
		t.Fatalf("ParseOutput agent_end type = %s/%s, want assistant/result", got.Type, got.Subtype)
	}
	if got.Message["subtype"] != "error" {
		t.Fatalf("result subtype = %#v, want error", got.Message["subtype"])
	}
	if got.Message["error"] != "Request timed out." {
		t.Fatalf("result error = %#v, want Request timed out.", got.Message["error"])
	}
}

func TestParseMessageEndErrorAsErrorEvent(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"Request timed out."}}`))

	if got.Type != "error" {
		t.Fatalf("ParseOutput message_end error type = %s, want error", got.Type)
	}
	if got.Message["message"] != "Request timed out." {
		t.Fatalf("error message = %#v, want Request timed out.", got.Message["message"])
	}
}

func TestParseError(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`{"type":"error","message":"boom"}`))

	if got.Type != "error" {
		t.Fatalf("ParseOutput error type = %s, want error", got.Type)
	}
	if got.Message["message"] != "boom" {
		t.Fatalf("error message = %#v, want boom", got.Message["message"])
	}
}

func TestParseInvalidJSONAsRaw(t *testing.T) {
	driver := &Driver{}

	got := driver.ParseOutput([]byte(`not json`))

	if got.Type != "raw" || got.Raw != "not json" {
		t.Fatalf("ParseOutput invalid = %#v, want raw event", got)
	}
}

func textFromAssistantEvent(t *testing.T, msg map[string]interface{}) string {
	t.Helper()
	message, ok := msg["message"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing assistant message: %#v", msg)
	}
	content, ok := message["content"].([]map[string]interface{})
	if !ok || len(content) != 1 {
		t.Fatalf("missing assistant content: %#v", message["content"])
	}
	text, _ := content[0]["text"].(string)
	return text
}

func isHiddenByDefault(msg map[string]interface{}) bool {
	debugMeta, ok := msg["debug_meta"].(map[string]interface{})
	if !ok {
		return false
	}
	hidden, _ := debugMeta["hidden_by_default"].(bool)
	return hidden
}
