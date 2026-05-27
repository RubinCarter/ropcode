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
