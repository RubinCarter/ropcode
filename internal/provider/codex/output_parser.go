package codex

import (
	"encoding/json"

	"ropcode/internal/provider"
)

func (d *Driver) ParseOutput(line []byte) *provider.OutputEvent {
	var raw map[string]interface{}
	if err := json.Unmarshal(line, &raw); err != nil {
		return &provider.OutputEvent{
			Type: "raw",
			Raw:  string(line),
		}
	}

	eventType, _ := raw["type"].(string)

	switch eventType {
	case "thread.started":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "init",
			Message: raw,
		}
	case "response_item":
		return d.parseResponseItem(raw)
	case "item.completed":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "completed",
			Message: raw,
		}
	case "turn.completed":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_completed",
			Message: raw,
		}
	case "thread.completed", "thread.cancelled":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "session_complete",
			Message: raw,
		}
	case "thread.error", "error", "turn.failed":
		return &provider.OutputEvent{
			Type:    "error",
			Message: raw,
		}
	case "message.delta":
		return &provider.OutputEvent{
			Type:    "assistant",
			IsDelta: true,
			Message: raw,
		}
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
	}
}

func (d *Driver) parseResponseItem(raw map[string]interface{}) *provider.OutputEvent {
	payload, _ := raw["payload"].(map[string]interface{})
	if payload == nil {
		return &provider.OutputEvent{Type: "assistant", Message: raw}
	}

	payloadType, _ := payload["type"].(string)
	switch payloadType {
	case "message":
		return &provider.OutputEvent{
			Type:    "assistant",
			Message: raw,
		}
	case "function_call", "custom_tool_call":
		return &provider.OutputEvent{
			Type:    "tool_use",
			Message: raw,
		}
	case "function_call_output":
		return &provider.OutputEvent{
			Type:    "tool_result",
			Message: raw,
		}
	default:
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: payloadType,
			Message: raw,
		}
	}
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	return &provider.StderrEvent{
		Level:   "error",
		Message: string(line),
	}
}
