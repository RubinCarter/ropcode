package gemini

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
	case "init":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "init",
			Message: raw,
		}
	case "message":
		return d.parseMessage(raw)
	case "tool_use":
		return d.parseToolUse(raw)
	case "tool_result":
		return d.parseToolResult(raw)
	case "result":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "result",
			Message: map[string]interface{}{
				"type":    "result",
				"result":  stringVal(raw, "result"),
				"subtype": "success",
			},
		}
	case "error", "turn.failed":
		return &provider.OutputEvent{
			Type: "error",
			Message: map[string]interface{}{
				"type":    "error",
				"message": stringVal(raw, "message"),
			},
		}
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
	}
}

func (d *Driver) parseMessage(raw map[string]interface{}) *provider.OutputEvent {
	role, _ := raw["role"].(string)
	text, _ := raw["content"].(string)

	if role == "user" {
		return &provider.OutputEvent{
			Type: "user",
			Message: map[string]interface{}{
				"type": "user",
				"message": map[string]interface{}{
					"role": "user",
					"content": []map[string]interface{}{
						{"type": "text", "text": text},
					},
				},
			},
		}
	}

	return &provider.OutputEvent{
		Type: "assistant",
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
}

func (d *Driver) parseToolUse(raw map[string]interface{}) *provider.OutputEvent {
	name, _ := raw["name"].(string)
	id, _ := raw["id"].(string)
	args, _ := raw["args"].(map[string]interface{})
	if args == nil {
		args, _ = raw["input"].(map[string]interface{})
	}

	claudeName, claudeInput := adaptGeminiToolCall(name, args)

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
}

func (d *Driver) parseToolResult(raw map[string]interface{}) *provider.OutputEvent {
	id, _ := raw["id"].(string)
	if id == "" {
		id, _ = raw["tool_use_id"].(string)
	}
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
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	message := strings.TrimSpace(string(line))
	level := "error"
	if strings.Contains(message, "WARN") {
		level = "warning"
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
