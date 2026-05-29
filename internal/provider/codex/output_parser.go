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
	case "turn/plan/updated":
		return adaptPlanEvent(params)
	case "turn/completed":
		return eventResult()
	case "item/started":
		return d.parseItemEvent(params, "started")
	case "item/completed":
		return d.parseItemEvent(params, "completed")
	case "item/agentMessage/delta":
		delta, _ := params["delta"].(string)
		return eventAssistantDelta(delta)
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
			Message: map[string]interface{}{
				"type":  "system",
				"usage": codexTokenUsage(params),
			},
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

	if phase == "started" {
		return d.parseItemStarted(item, itemType, params)
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
		return eventAssistantText(text)
	case "reasoning":
		text := codexReasoningText(item)
		if text == "" {
			return &provider.OutputEvent{
				Type:    "system",
				Subtype: "reasoning_completed",
				Message: params,
			}
		}
		return eventThinking(text)
	case "commandExecution":
		return d.parseCommandExecution(item, params)
	case "functionCall", "localShellExec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		id, _ := item["id"].(string)
		args := extractFunctionCallArgs(item)
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return eventToolUse(id, claudeName, claudeInput)
	case "functionCallOutput", "localShellOutput":
		output, _ := item["output"].(string)
		callID, _ := item["call_id"].(string)
		if callID == "" {
			callID, _ = item["id"].(string)
		}
		return eventToolResult(callID, output, false)
	case "collab_tool_call":
		output, _ := item["output"].(string)
		callID, _ := item["call_id"].(string)
		if callID == "" {
			callID, _ = item["id"].(string)
		}
		return eventToolResult(callID, output, false)
	case "collabAgentToolCall":
		id, _ := item["id"].(string)
		output := extractCollabAgentOutput(item)
		return eventToolResult(id, output, false)
	case "webSearch":
		id, _ := item["id"].(string)
		query, _ := item["query"].(string)
		return eventToolResult(id, query, false)
	default:
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: itemType + "_completed",
			Message: params,
		}
	}
}

func (d *Driver) parseItemStarted(item map[string]interface{}, itemType string, params map[string]interface{}) *provider.OutputEvent {
	if itemType == "commandExecution" {
		id, _ := item["id"].(string)
		command := extractShellCommand(item)
		toolName, toolInput := adaptCommandAction(item, command)
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "id": id, "name": toolName, "input": toolInput},
					},
				},
			},
		}
	}
	if itemType == "webSearch" {
		id, _ := item["id"].(string)
		query, _ := item["query"].(string)
		return &provider.OutputEvent{
			Type: "assistant",
			Message: map[string]interface{}{
				"type": "assistant",
				"message": map[string]interface{}{
					"role": "assistant",
					"content": []map[string]interface{}{
						{"type": "tool_use", "id": id, "name": "WebSearch", "input": map[string]interface{}{"query": query}},
					},
				},
			},
		}
	}
	if itemType == "functionCall" || itemType == "collabAgentToolCall" {
		id, _ := item["id"].(string)
		name, _ := item["name"].(string)
		if itemType == "collabAgentToolCall" {
			tool, _ := item["tool"].(string)
			prompt, _ := item["prompt"].(string)
			switch tool {
			case "spawnAgent":
				return eventToolUse(id, "Agent", map[string]interface{}{
					"prompt":        prompt,
					"subagent_type": mapAgentType(""),
					"description":   prompt,
				})
			default:
				return nil
			}
		} else {
			args := extractFunctionCallArgs(item)
			claudeName, claudeInput := adaptToolCall(name, args)
			if claudeName == "" {
				return nil
			}
			return eventToolUse(id, claudeName, claudeInput)
		}
	}
	return &provider.OutputEvent{
		Type:    "system",
		Subtype: itemType + "_started",
		Message: params,
	}
}

func (d *Driver) parseCommandExecution(item map[string]interface{}, params map[string]interface{}) *provider.OutputEvent {
	id, _ := item["id"].(string)
	output, _ := item["aggregatedOutput"].(string)
	exitCode, _ := item["exitCode"].(float64)
	isError := int(exitCode) != 0
	return eventToolResult(id, output, isError)
}

func extractShellCommand(item map[string]interface{}) string {
	command, _ := item["command"].(string)
	// Strip shell wrapper like "/bin/zsh -lc 'actual command'"
	if actions, ok := item["commandActions"].([]interface{}); ok && len(actions) > 0 {
		if action, ok := actions[0].(map[string]interface{}); ok {
			if cmd, ok := action["command"].(string); ok && cmd != "" {
				return cmd
			}
		}
	}
	return command
}

func extractBatchCommand(item map[string]interface{}) string {
	command, _ := item["command"].(string)
	// Batch format wraps commands in "/bin/zsh -lc '...'"
	const prefix = "/bin/zsh -lc '"
	if strings.HasPrefix(command, prefix) && strings.HasSuffix(command, "'") {
		return command[len(prefix) : len(command)-1]
	}
	return command
}

func extractCollabAgentOutput(item map[string]interface{}) string {
	return extractAgentResult(item)
}

func codexReasoningText(item map[string]interface{}) string {
	if text, ok := item["text"].(string); ok && text != "" {
		return text
	}
	for _, s := range sliceVal(item["summary"]) {
		if block, ok := s.(map[string]interface{}); ok {
			if text, ok := block["text"].(string); ok && text != "" {
				return text
			}
		}
	}
	for _, c := range sliceVal(item["content"]) {
		if block, ok := c.(map[string]interface{}); ok {
			if text, ok := block["text"].(string); ok && text != "" {
				return text
			}
		}
	}
	return ""
}

func sliceVal(v interface{}) []interface{} {
	if s, ok := v.([]interface{}); ok {
		return s
	}
	return nil
}

func codexTokenUsage(params map[string]interface{}) map[string]interface{} {
	tokenUsage, _ := params["tokenUsage"].(map[string]interface{})
	if tokenUsage == nil {
		return nil
	}
	last, _ := tokenUsage["last"].(map[string]interface{})
	if last == nil {
		last, _ = tokenUsage["total"].(map[string]interface{})
	}
	if last == nil {
		return nil
	}
	return map[string]interface{}{
		"input_tokens":                last["inputTokens"],
		"output_tokens":               last["outputTokens"],
		"cache_read_input_tokens":     last["cachedInputTokens"],
		"cache_creation_input_tokens": last["cachedOutputTokens"],
		"total_tokens":                last["totalTokens"],
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
	case "turn.started":
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_started",
			Message: raw,
		}
	case "item.started":
		return d.parseBatchItemStarted(raw)
	case "response_item":
		return d.parseBatchResponseItem(raw)
	case "item.completed":
		return d.parseBatchItemCompleted(raw)
	case "turn.completed":
		return eventResult()
	case "thread.completed", "thread.cancelled":
		return eventResult()
	case "thread.error", "error", "turn.failed":
		msg, _ := raw["message"].(string)
		return eventError(msg)
	case "message.delta":
		delta, _ := raw["delta"].(string)
		return eventAssistantDelta(delta)
	default:
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
	}
}

func (d *Driver) parseBatchItemStarted(raw map[string]interface{}) *provider.OutputEvent {
	item, _ := raw["item"].(map[string]interface{})
	if item == nil {
		return &provider.OutputEvent{Type: "system", Subtype: "item_started", Message: raw}
	}
	itemType, _ := item["type"].(string)
	switch itemType {
	case "command_execution":
		id, _ := item["id"].(string)
		command := extractBatchCommand(item)
		toolName, toolInput := adaptCommandAction(item, command)
		return eventToolUse(id, toolName, toolInput)
	default:
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: itemType + "_started",
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
	case "command_execution":
		id, _ := item["id"].(string)
		output, _ := item["aggregated_output"].(string)
		exitCode, _ := item["exit_code"].(float64)
		isError := int(exitCode) != 0
		return eventToolResult(id, output, isError)
	case "agent_message", "message":
		text, _ := item["text"].(string)
		return eventAssistantText(text)
	case "function_call", "local_shell_exec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		id, _ := item["id"].(string)
		args := extractFunctionCallArgs(item)
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return eventToolUse(id, claudeName, claudeInput)
	case "function_call_output", "local_shell_output":
		output, _ := item["output"].(string)
		return eventToolResult("", output, false)
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
		if role, _ := payload["role"].(string); role == "user" {
			return &provider.OutputEvent{
				Type:    "user",
				Message: userText(text),
			}
		}
		return eventAssistantText(text)
	case "function_call", "custom_tool_call":
		name, _ := payload["name"].(string)
		return eventToolUse("", name, payload)
	case "function_call_output":
		output, _ := payload["output"].(string)
		return eventToolResult("", output, false)
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
	if isStderrNoise(message) {
		return nil
	}
	level := "error"
	if isStderrWarning(message) ||
		strings.Contains(message, " WARN ") ||
		strings.Contains(message, "\tWARN\t") ||
		strings.Contains(message, "\tWARN ") {
		level = "warning"
	}
	return &provider.StderrEvent{
		Level:   level,
		Message: message,
	}
}
