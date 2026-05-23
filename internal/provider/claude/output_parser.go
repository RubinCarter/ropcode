package claude

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
	case "system":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: getString(raw, "subtype"),
			Message: raw,
		}
	case "assistant":
		return &provider.OutputEvent{
			Type:    "assistant",
			Message: raw,
		}
	case "user":
		return &provider.OutputEvent{
			Type:    "user",
			Message: raw,
		}
	case "tool_progress":
		return &provider.OutputEvent{
			Type:    "tool_use",
			Subtype: "progress",
			Message: raw,
		}
	case "result":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "result",
			Message: raw,
		}
	case "rate_limit_event":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "rate_limit",
			Message: raw,
		}
	case "control_response":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "control_response",
			Message: raw,
		}
	default:
		return &provider.OutputEvent{
			Type:    eventType,
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

func getString(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}
