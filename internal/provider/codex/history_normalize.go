package codex

import "ropcode/internal/provider"

func init() {
	provider.RegisterHistoryNormalizer("codex", NormalizeHistoryEntry)
}

func NormalizeHistoryEntry(raw map[string]any) provider.OutputEvent {
	eventType := str(raw, "type")

	var msg map[string]any
	switch eventType {
	case "response_item":
		msg = normalizePayloadHistory(mval(raw["payload"]))
	case "item.completed":
		msg = normalizeItemHistory(mval(raw["item"]))
	case "message.delta":
		msg = assistantText(str(raw, "delta"))
	case "turn.completed", "thread.completed", "thread.cancelled":
		msg = map[string]any{"type": "result", "subtype": "success"}
	case "thread.error", "error", "turn.failed":
		msg = map[string]any{"type": "error", "message": str(raw, "message")}
	default:
		msg = raw
	}

	return provider.OutputEvent{
		Type:    historyEventType(raw),
		Subtype: historySubtype(raw),
		Message: msg,
	}
}

func historyEventType(raw map[string]any) string {
	switch str(raw, "type") {
	case "thread.started", "session_meta":
		return "system"
	case "turn.completed", "thread.completed", "thread.cancelled":
		return "assistant"
	case "thread.error", "error", "turn.failed":
		return "error"
	case "message.delta":
		return "assistant"
	case "response_item":
		payloadType := str(mval(raw["payload"]), "type")
		switch payloadType {
		case "function_call_output", "custom_tool_call_output":
			return "user"
		default:
			return "assistant"
		}
	case "item.completed":
		itemType := str(mval(raw["item"]), "type")
		switch itemType {
		case "function_call_output", "local_shell_output":
			return "user"
		default:
			return "assistant"
		}
	default:
		return "assistant"
	}
}

func historySubtype(raw map[string]any) string {
	switch str(raw, "type") {
	case "thread.started", "session_meta":
		return "init"
	case "turn.completed", "thread.completed", "thread.cancelled":
		return "result"
	}
	if str(raw, "type") == "response_item" {
		return str(mval(raw["payload"]), "type")
	}
	return str(raw, "subtype")
}

func normalizePayloadHistory(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	switch str(payload, "type") {
	case "message":
		return assistantText(payloadText(payload))
	case "reasoning":
		text := payloadText(payload)
		if text == "" {
			for _, s := range sval(payload["summary"]) {
				if t := str(mval(s), "text"); t != "" {
					text = t
					break
				}
			}
		}
		if text == "" {
			return nil
		}
		return map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role": "assistant",
				"content": []interface{}{
					map[string]any{"type": "thinking", "thinking": text},
				},
			},
		}
	case "function_call", "custom_tool_call":
		return toolUse(str(payload, "call_id"), str(payload, "name"), payload)
	case "function_call_output", "custom_tool_call_output":
		return toolResult(str(payload, "call_id"), str(payload, "output"))
	default:
		return nil
	}
}

func normalizeItemHistory(item map[string]any) map[string]any {
	if item == nil {
		return nil
	}
	switch str(item, "type") {
	case "agent_message", "message":
		return assistantText(str(item, "text"))
	case "command_execution", "function_call", "local_shell_exec":
		name := str(item, "name")
		if name == "" {
			name = str(item, "command")
		}
		if name == "" {
			name = "Bash"
		}
		return toolUse(str(item, "id"), name, item)
	case "function_call_output", "local_shell_output":
		return toolResult(str(item, "id"), str(item, "output"))
	default:
		return nil
	}
}

func payloadText(payload map[string]any) string {
	if text := str(payload, "text"); text != "" {
		return text
	}
	for _, item := range sval(payload["content"]) {
		if text := str(mval(item), "text"); text != "" {
			return text
		}
	}
	return ""
}

func assistantText(text string) map[string]any {
	return map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []interface{}{map[string]any{"type": "text", "text": text}},
		},
	}
}

func toolUse(id, name string, input any) map[string]any {
	return map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []interface{}{map[string]any{"type": "tool_use", "id": id, "name": name, "input": input}},
		},
	}
}

func toolResult(toolUseID, content string) map[string]any {
	return map[string]any{
		"type": "user",
		"message": map[string]any{
			"role": "user",
			"content": []interface{}{map[string]any{"type": "tool_result", "tool_use_id": toolUseID, "content": content}},
		},
	}
}

func str(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func mval(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func sval(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}
