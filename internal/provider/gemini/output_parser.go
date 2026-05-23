package gemini

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
	case "init":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "init",
			Message: raw,
		}
	case "message":
		role, _ := raw["role"].(string)
		if role == "user" {
			return &provider.OutputEvent{
				Type:    "user",
				Message: raw,
			}
		}
		return &provider.OutputEvent{
			Type:    "assistant",
			Message: raw,
		}
	case "tool_use":
		return &provider.OutputEvent{
			Type:    "tool_use",
			Message: raw,
		}
	case "tool_result":
		return &provider.OutputEvent{
			Type:    "tool_result",
			Message: raw,
		}
	case "result":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "session_complete",
			Message: raw,
		}
	case "error", "turn.failed":
		return &provider.OutputEvent{
			Type:    "error",
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
