package deepseek

import "ropcode/internal/provider"

func init() {
	provider.RegisterHistoryNormalizer("deepseek", NormalizeHistoryEntry)
	provider.RegisterHistoryDocNormalizer("deepseek", NormalizeHistoryDocument)
}

func NormalizeHistoryEntry(raw map[string]any) provider.OutputEvent {
	eventType, _ := raw["type"].(string)
	if eventType == "" {
		if role, _ := raw["role"].(string); role == "user" || role == "user_message" {
			eventType = "user"
		} else {
			eventType = "content"
		}
	}

	outputType := "assistant"
	subtype := ""
	switch eventType {
	case "tool_use":
		outputType = "assistant"
	case "tool_result":
		outputType = "user"
	case "session_capture":
		outputType = "system"
		subtype = "session_capture"
	case "metadata":
		outputType = "system"
		subtype = "metadata"
	case "done":
		outputType = "assistant"
		subtype = "result"
	case "error":
		outputType = "error"
	case "user", "user_message":
		outputType = "user"
	}

	return provider.OutputEvent{
		Type:    outputType,
		Subtype: subtype,
		Message: normalizeHistoryMessage(eventType, raw),
	}
}

func NormalizeHistoryDocument(raw map[string]any) []provider.OutputEvent {
	var events []provider.OutputEvent
	for _, key := range []string{"messages", "turns", "items"} {
		items, _ := raw[key].([]any)
		if len(items) == 0 {
			continue
		}
		for _, item := range items {
			itemMap, _ := item.(map[string]any)
			if len(itemMap) == 0 {
				continue
			}
			event := NormalizeHistoryEntry(itemMap)
			if event.Message != nil {
				events = append(events, event)
			}
		}
		break
	}
	return events
}

func normalizeHistoryMessage(eventType string, item map[string]any) map[string]any {
	switch eventType {
	case "content", "assistant":
		return historyAssistantText(historyText(item))
	case "user", "user_message":
		return map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []interface{}{map[string]any{"type": "text", "text": historyText(item)}},
			},
		}
	case "tool_use":
		name, input := mapToolName(stringVal(item, "name"), mapAny(item["input"]))
		return map[string]any{
			"type": "assistant",
			"message": map[string]any{
				"role": "assistant",
				"content": []interface{}{map[string]any{"type": "tool_use", "id": stringVal(item, "id"), "name": name, "input": input}},
			},
		}
	case "tool_result":
		return map[string]any{
			"type": "user",
			"message": map[string]any{
				"role": "user",
				"content": []interface{}{map[string]any{"type": "tool_result", "tool_use_id": stringVal(item, "id"), "content": stringVal(item, "output")}},
			},
		}
	case "done":
		return map[string]any{"type": "result", "subtype": "success"}
	case "error":
		return map[string]any{"type": "error", "message": stringVal(item, "message")}
	default:
		return item
	}
}

func historyAssistantText(text string) map[string]any {
	return map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []interface{}{map[string]any{"type": "text", "text": text}},
		},
	}
}

func historyText(item map[string]any) string {
	for _, key := range []string{"content", "text", "detail", "summary", "prompt"} {
		if text := stringVal(item, key); text != "" {
			return text
		}
	}
	if content, ok := item["content"].([]any); ok {
		for _, block := range content {
			if m, ok := block.(map[string]any); ok {
				if text := stringVal(m, "text"); text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func mapToolName(name string, input map[string]any) (string, map[string]any) {
	if input == nil {
		input = map[string]any{}
	}
	switch name {
	case "exec_shell":
		cmd := stringVal(input, "command")
		if cmd == "" {
			cmd = stringVal(input, "cmd")
		}
		return "Bash", map[string]any{"command": cmd}
	case "read_file":
		return "Read", map[string]any{"file_path": stringVal(input, "path")}
	case "write_file":
		return "Write", map[string]any{"file_path": stringVal(input, "path"), "content": stringVal(input, "content")}
	case "run_shell_command":
		return "Bash", map[string]any{"command": stringVal(input, "command")}
	default:
		return name, input
	}
}

func mapAny(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}
