package pi

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

	eventType := firstString(raw, "type")
	switch eventType {
	case "response":
		msg := copyMap(raw)
		msg["session_id"] = firstNestedString(raw, "data", "sessionId")
		msg["session_file"] = firstNestedString(raw, "data", "sessionFile")
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "response",
			Message: msg,
		}
	case "message_update":
		return assistantDelta(firstString(raw, "delta", "content", "message"))
	case "message":
		return assistantText(firstString(raw, "content", "message", "delta"))
	case "agent_start":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "agent_start",
			Message: raw,
		}
	case "agent_end":
		success, _ := raw["success"].(bool)
		return resultEvent(success)
	case "error":
		return errorEvent(firstString(raw, "message", "error"))
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
			Raw:     string(line),
		}
	}
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	message := strings.TrimSpace(string(line))
	level := "warning"
	upper := strings.ToUpper(message)
	if strings.Contains(upper, "ERROR") || strings.Contains(upper, "FATAL") ||
		strings.Contains(message, "Traceback") || strings.Contains(message, "panic:") {
		level = "error"
	}
	return &provider.StderrEvent{
		Level:   level,
		Message: message,
	}
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func firstNestedString(m map[string]interface{}, parent, key string) string {
	child, ok := m[parent].(map[string]interface{})
	if !ok {
		return ""
	}
	return firstString(child, key)
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	cp := make(map[string]interface{}, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}
