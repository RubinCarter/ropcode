package codex

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

	// JSON-RPC response (has "id" field) — handle initialize and thread/start responses
	if _, hasID := raw["id"]; hasID {
		return d.parseResponse(raw)
	}

	// JSON-RPC notification (has "method" field) — streaming events
	method, _ := raw["method"].(string)
	params, _ := raw["params"].(map[string]interface{})
	if params == nil {
		params = raw
	}

	switch method {
	case "turn/started":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_started",
			Message: params,
		}
	case "turn/completed":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_completed",
			Message: params,
		}
	case "item/started":
		return d.parseItemEvent(params, "started")
	case "item/completed":
		return d.parseItemEvent(params, "completed")
	case "item/agentMessage/delta":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "delta",
			IsDelta: true,
			Message: params,
		}
	case "thread/started":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "thread_started",
			Message: params,
		}
	case "thread/status/changed":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "status_changed",
			Message: params,
		}
	case "thread/tokenUsage/updated":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "token_usage",
			Message: params,
		}
	case "mcpServer/startupStatus/updated":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "mcp_status",
			Message: params,
		}
	case "remoteControl/status/changed":
		return nil
	default:
		if method != "" {
			return &provider.OutputEvent{
				Type:    "system",
				Subtype: method,
				Message: params,
			}
		}
		// Legacy exec --json format
		return d.parseBatchEvent(raw)
	}
}

func (d *Driver) parseResponse(raw map[string]interface{}) *provider.OutputEvent {
	id := raw["id"]

	// Error response
	if errObj, ok := raw["error"].(map[string]interface{}); ok {
		return &provider.OutputEvent{
			Type:    "error",
			Message: errObj,
		}
	}

	result, _ := raw["result"].(map[string]interface{})

	// Initialize response
	if id == "init_1" {
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "control_response",
			Message: raw,
		}
	}

	// thread/start response — extract thread ID
	if id == "thread_1" && result != nil {
		if thread, ok := result["thread"].(map[string]interface{}); ok {
			if threadID, ok := thread["id"].(string); ok {
				return &provider.OutputEvent{
					Type:    "system",
					Subtype: "thread_created",
					Message: map[string]interface{}{
						"thread_id":  threadID,
						"session_id": threadID,
					},
				}
			}
		}
	}

	return &provider.OutputEvent{
		Type:    "system",
		Subtype: "response",
		Message: raw,
	}
}

func (d *Driver) parseItemEvent(params map[string]interface{}, phase string) *provider.OutputEvent {
	item, _ := params["item"].(map[string]interface{})
	if item == nil {
		return &provider.OutputEvent{Type: "system", Subtype: "item_" + phase, Message: params}
	}

	itemType, _ := item["type"].(string)

	// Only emit completed items as full messages (started items are just status)
	if phase == "started" {
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: itemType + "_started",
			Message: params,
		}
	}

	switch itemType {
	case "userMessage":
		text := extractTextFromItem(item)
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
	case "agentMessage":
		text, _ := item["text"].(string)
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
	case "reasoning":
		return &provider.OutputEvent{
			Type:    "assistant",
			Subtype: "reasoning",
			Message: params,
		}
	case "functionCall", "localShellExec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "name": name, "input": item},
					},
				},
			},
		}
	case "functionCallOutput", "localShellOutput":
		output, _ := item["output"].(string)
		return &provider.OutputEvent{
			Type: "tool_result",
			Message: map[string]interface{}{
				"type": "tool_result",
				"message": map[string]interface{}{
					"role": "tool",
					"content": []map[string]interface{}{
						{"type": "text", "text": output},
					},
				},
			},
		}
	default:
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: itemType + "_" + phase,
			Message: params,
		}
	}
}

func extractTextFromItem(item map[string]interface{}) string {
	if text, ok := item["text"].(string); ok {
		return text
	}
	if content, ok := item["content"].([]interface{}); ok {
		for _, block := range content {
			if m, ok := block.(map[string]interface{}); ok {
				if t, ok := m["text"].(string); ok {
					return t
				}
			}
		}
	}
	return ""
}

// parseBatchEvent handles legacy `codex exec --json` JSONL format
func (d *Driver) parseBatchEvent(raw map[string]interface{}) *provider.OutputEvent {
	eventType, _ := raw["type"].(string)

	switch eventType {
	case "thread.started":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "init",
			Message: raw,
		}
	case "response_item":
		return d.parseBatchResponseItem(raw)
	case "item.completed":
		return d.parseBatchItemCompleted(raw)
	case "turn.completed":
		return &provider.OutputEvent{
			Type:    "result",
			Subtype: "result",
			Message: map[string]interface{}{
				"type":    "result",
				"subtype": "success",
			},
		}
	case "thread.completed", "thread.cancelled":
		return &provider.OutputEvent{
			Type:    "result",
			Subtype: "result",
			Message: map[string]interface{}{
				"type":    "result",
				"subtype": "success",
			},
		}
	case "thread.error", "error", "turn.failed":
		msg, _ := raw["message"].(string)
		return &provider.OutputEvent{
			Type: "error",
			Message: map[string]interface{}{
				"type":    "error",
				"message": msg,
			},
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

func (d *Driver) parseBatchItemCompleted(raw map[string]interface{}) *provider.OutputEvent {
	item, _ := raw["item"].(map[string]interface{})
	if item == nil {
		return &provider.OutputEvent{Type: "assistant", Message: raw}
	}
	itemType, _ := item["type"].(string)
	switch itemType {
	case "agent_message", "message":
		text, _ := item["text"].(string)
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
	case "function_call", "local_shell_exec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "name": name, "input": item},
					},
				},
			},
		}
	case "function_call_output", "local_shell_output":
		output, _ := item["output"].(string)
		return &provider.OutputEvent{
			Type: "tool_result",
			Message: map[string]interface{}{
				"type": "tool_result",
				"message": map[string]interface{}{
					"role": "tool",
					"content": []map[string]interface{}{
						{"type": "text", "text": output},
					},
				},
			},
		}
	default:
		return &provider.OutputEvent{Type: "assistant", Message: raw}
	}
}

func (d *Driver) parseBatchResponseItem(raw map[string]interface{}) *provider.OutputEvent {
	payload, _ := raw["payload"].(map[string]interface{})
	if payload == nil {
		return &provider.OutputEvent{Type: "assistant", Message: raw}
	}
	payloadType, _ := payload["type"].(string)
	switch payloadType {
	case "message":
		text := extractTextFromPayload(payload)
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
	case "function_call", "custom_tool_call":
		name, _ := payload["name"].(string)
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "name": name, "input": payload},
					},
				},
			},
		}
	case "function_call_output":
		output, _ := payload["output"].(string)
		return &provider.OutputEvent{
			Type: "tool_result",
			Message: map[string]interface{}{
				"type": "tool_result",
				"message": map[string]interface{}{
					"role": "tool",
					"content": []map[string]interface{}{
						{"type": "text", "text": output},
					},
				},
			},
		}
	default:
		return &provider.OutputEvent{Type: "assistant", Subtype: payloadType, Message: raw}
	}
}

func extractTextFromPayload(payload map[string]interface{}) string {
	if text, ok := payload["text"].(string); ok {
		return text
	}
	if content, ok := payload["content"].([]interface{}); ok {
		for _, item := range content {
			if m, ok := item.(map[string]interface{}); ok {
				if t, ok := m["text"].(string); ok {
					return t
				}
			}
		}
	}
	return ""
}

func (d *Driver) ParseStderr(line []byte) *provider.StderrEvent {
	message := strings.TrimSpace(string(line))
	if message == "Reading additional input from stdin..." {
		return nil
	}
	level := "error"
	if strings.Contains(message, " WARN ") || strings.Contains(message, "\tWARN ") {
		level = "warning"
	}
	return &provider.StderrEvent{
		Level:   level,
		Message: message,
	}
}
