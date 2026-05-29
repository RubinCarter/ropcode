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
		if text := firstString(raw, "delta", "content"); text != "" {
			return assistantDelta(text)
		}
		if event := nestedMap(raw, "assistantMessageEvent"); event != nil {
			if firstString(event, "type") == "text_delta" {
				text := firstString(event, "delta")
				return assistantDelta(text)
			}
			if errorMessage := firstString(event, "errorMessage", "error"); errorMessage != "" {
				return errorEvent(errorMessage)
			}
		}
		if message := nestedMap(raw, "message"); message != nil {
			if errorMessage := firstString(message, "errorMessage", "error"); errorMessage != "" {
				return errorEvent(errorMessage)
			}
		}
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: eventType,
			Message: hiddenMetadata(raw),
		}
	case "message":
		return assistantText(firstString(raw, "content", "message", "delta"))
	case "message_start":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: eventType,
			Message: hiddenMetadata(raw),
		}
	case "message_end":
		if message := nestedMap(raw, "message"); message != nil {
			if errorMessage := firstString(message, "errorMessage", "error"); errorMessage != "" {
				return errorEvent(errorMessage)
			}
		}
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: eventType,
			Message: hiddenMetadata(raw),
		}
	case "turn_start":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_start",
			Message: raw,
		}
	case "turn_end":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_end",
			Message: raw,
		}
	case "agent_start":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "agent_start",
			Message: raw,
		}
	case "agent_end":
		success := true
		if value, ok := raw["success"].(bool); ok {
			success = value
		}
		errorMessage := errorMessageFromAgentEnd(raw)
		if errorMessage != "" {
			success = false
		}
		return resultEventWithMessage(success, errorMessage)
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
	child := nestedMap(m, parent)
	if child == nil {
		return ""
	}
	return firstString(child, key)
}

func nestedMap(m map[string]interface{}, key string) map[string]interface{} {
	child, ok := m[key].(map[string]interface{})
	if !ok {
		return nil
	}
	return child
}

func errorMessageFromAgentEnd(raw map[string]interface{}) string {
	if message := firstString(raw, "errorMessage", "error", "message"); message != "" {
		return message
	}
	messages, ok := raw["messages"].([]interface{})
	if !ok {
		return ""
	}
	for i := len(messages) - 1; i >= 0; i-- {
		message, ok := messages[i].(map[string]interface{})
		if !ok {
			continue
		}
		if errorMessage := firstString(message, "errorMessage", "error"); errorMessage != "" {
			return errorMessage
		}
	}
	return ""
}

func textFromMessageContent(message map[string]interface{}) string {
	content, ok := message["content"].([]interface{})
	if !ok {
		return ""
	}
	var parts []string
	for _, item := range content {
		block, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if text := firstString(block, "text"); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "")
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	cp := make(map[string]interface{}, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}

func hiddenMetadata(m map[string]interface{}) map[string]interface{} {
	cp := copyMap(m)
	debugMeta, ok := cp["debug_meta"].(map[string]interface{})
	if !ok {
		debugMeta = make(map[string]interface{})
		cp["debug_meta"] = debugMeta
	}
	debugMeta["hidden_by_default"] = true
	return cp
}
