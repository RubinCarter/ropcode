package deepseek

import (
	"encoding/json"
	"strings"

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
	case "content":
		text, _ := raw["content"].(string)
		return &provider.OutputEvent{
			Type:    "assistant",
			IsDelta: true,
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "text", "text": text},
					},
				},
			},
		}
	case "tool_use":
		id, _ := raw["id"].(string)
		name, _ := raw["name"].(string)
		input, _ := raw["input"].(map[string]interface{})
		claudeName, claudeInput := mapToolName(name, input)
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "id": id, "name": claudeName, "input": claudeInput},
					},
				},
			},
		}
	case "tool_result":
		id, _ := raw["id"].(string)
		output, _ := raw["output"].(string)
		status, _ := raw["status"].(string)
		isError := status == "error"
		return &provider.OutputEvent{
			Type: "user",
			Message: map[string]interface{}{
				"type": "user",
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{"type": "tool_result", "tool_use_id": id, "content": output, "is_error": isError},
					},
				},
			},
		}
	case "session_capture":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "session_capture",
			Message: raw,
		}
	case "metadata":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "metadata",
			Message: raw,
		}
	case "done":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "result",
			Message: map[string]interface{}{
				"type":    "result",
				"subtype": "success",
			},
		}
	case "error":
		msg, _ := raw["message"].(string)
		return &provider.OutputEvent{
			Type: "error",
			Message: map[string]interface{}{
				"type":    "error",
				"message": msg,
			},
		}
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
	}
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	message := strings.TrimSpace(string(line))
	level := "warning"
	upper := strings.ToUpper(message)
	if strings.Contains(upper, "ERROR") ||
		strings.Contains(upper, "FATAL") ||
		strings.Contains(message, "Traceback") ||
		strings.Contains(message, "panic:") {
		level = "error"
	}
	return &provider.StderrEvent{
		Level:   level,
		Message: message,
	}
}

func stringVal(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}
