package codex

import (
	"encoding/json"
	"regexp"
	"strconv"
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
		d.rememberTurnStarted(params)
		return d.applySubagentScope(&provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_started",
			Message: params,
		}, params)
	case "turn/plan/updated":
		return d.applySubagentScope(adaptPlanEvent(params), params)
	case "turn/completed":
		d.rememberTurnCompleted(params)
		return d.applySubagentScope(eventResultWithMeta(params), params)
	case "item/started":
		return d.applySubagentScope(d.parseItemEvent(params, "started"), params)
	case "item/completed":
		return d.applySubagentScope(d.parseItemEvent(params, "completed"), params)
	case "item/agentMessage/delta":
		delta, _ := params["delta"].(string)
		messageID := codexItemMessageID(params)
		return d.applySubagentScope(eventAssistantDelta(messageID, delta), params)
	case "thread/started":
		return d.applySubagentScope(&provider.OutputEvent{
			Type:    "system",
			Subtype: "thread_started",
			Message: params,
		}, params)
	case "thread/status/changed":
		return d.applySubagentScope(&provider.OutputEvent{
			Type:    "system",
			Subtype: "status_changed",
			Message: params,
		}, params)
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
	if _, ok := raw["error"].(map[string]interface{}); ok {
		return &provider.OutputEvent{
			Type:    "system",
			Subtype: "response",
			Message: raw,
		}
	}

	result, _ := raw["result"].(map[string]interface{})

	// Initialize response
	if id == initializeRequestID {
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
					Subtype: "init",
					Message: map[string]interface{}{
						"type":       "system",
						"subtype":    "init",
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
		if strings.TrimSpace(text) == "" {
			return nil
		}
		messageID := codexItemMessageID(params)
		return eventAssistantText(messageID, text)
	case "reasoning":
		text := codexReasoningText(item)
		if text == "" {
			return nil
		}
		return eventThinking(text)
	case "commandExecution":
		return d.parseCommandExecution(item, params)
	case "functionCall", "customToolCall", "localShellExec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		id := firstNonEmpty(str(item, "id"), str(item, "call_id"), str(item, "callId"))
		args := extractFunctionCallArgs(item)
		if d.rememberFunctionCallTool(id, name, args) {
			return nil
		}
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return eventToolUse(id, claudeName, claudeInput)
	case "functionCallOutput", "customToolCallOutput", "localShellOutput":
		output, _ := item["output"].(string)
		callID := firstNonEmpty(str(item, "call_id"), str(item, "callId"), str(item, "id"))
		return d.eventFunctionCallOutput(callID, output, itemType == "localShellOutput")
	case "collab_tool_call":
		output, _ := item["output"].(string)
		callID := firstNonEmpty(str(item, "call_id"), str(item, "callId"), str(item, "id"))
		return eventToolResult(callID, output, false)
	case "collabAgentToolCall":
		return d.parseCollabAgentCompleted(item, params)
	case "webSearch":
		id, _ := item["id"].(string)
		toolName, input, key := codexWebActionTool(item)
		if toolName == "" || key == "" {
			return nil
		}
		alreadyStarted := d.hasWebActionToolUse(id, key)
		d.rememberWebActionToolUse(id, key)
		result := codexWebActionResultText(toolName, input)
		if alreadyStarted {
			return eventToolResult(id, result, false)
		}
		return eventToolUseWithResult(id, toolName, input, result, false)
	default:
		return nil
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
		toolName, input, key := codexWebActionTool(item)
		if toolName == "" || key == "" || !d.rememberWebActionToolUse(id, key) {
			return nil
		}
		return eventToolUse(id, toolName, input)
	}
	if itemType == "functionCall" || itemType == "customToolCall" || itemType == "collabAgentToolCall" {
		id := firstNonEmpty(str(item, "id"), str(item, "call_id"), str(item, "callId"))
		name, _ := item["name"].(string)
		if itemType == "collabAgentToolCall" {
			tool, _ := item["tool"].(string)
			switch tool {
			case "spawnAgent":
				d.rememberSubagentSpawn(item)
				return eventToolUse(id, "Agent", codexSubagentToolInput(item))
			default:
				return nil
			}
		} else {
			args := extractFunctionCallArgs(item)
			if d.rememberFunctionCallTool(id, name, args) {
				return nil
			}
			claudeName, claudeInput := adaptToolCall(name, args)
			if claudeName == "" {
				return nil
			}
			return eventToolUse(id, claudeName, claudeInput)
		}
	}
	return nil
}

func (d *Driver) parseCommandExecution(item map[string]interface{}, params map[string]interface{}) *provider.OutputEvent {
	id, _ := item["id"].(string)
	output, _ := item["aggregatedOutput"].(string)
	exitCode, _ := item["exitCode"].(float64)
	isError := int(exitCode) != 0
	command := extractShellCommand(item)
	return eventToolResult(id, normalizeCodexCommandResult(item, command, output), isError)
}

var (
	codexOSCSequence    = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)
	codexCSISequence    = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
	codexEscapeSequence = regexp.MustCompile(`\x1b[@-Z\\-_]`)
	codexControlChars   = regexp.MustCompile(`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`)
	codexRopcodeSILine  = regexp.MustCompile(`(?m)^.*(?:__ropcode_si_|__ROPCODE_SHELL_INTEGRATION__|16162;[A-Z]).*(?:\r?\n|$)`)
	codexBlankLineRuns  = regexp.MustCompile(`\n{3,}`)
	codexGrepFileLine   = regexp.MustCompile(`.+:\d+:`)
	codexGrepLineOnly   = regexp.MustCompile(`^(\d+):(.*)$`)
	codexSessionIDLine  = regexp.MustCompile(`Process running with session ID\s+([0-9]+)`)
)

func sanitizeCodexShellOutput(output string) string {
	if output == "" {
		return ""
	}
	output = strings.ReplaceAll(output, "\r\n", "\n")
	output = strings.ReplaceAll(output, "\r", "\n")
	output = codexOSCSequence.ReplaceAllString(output, "")
	output = codexCSISequence.ReplaceAllString(output, "")
	output = codexEscapeSequence.ReplaceAllString(output, "")
	output = codexRopcodeSILine.ReplaceAllString(output, "")
	output = codexControlChars.ReplaceAllString(output, "")
	output = codexBlankLineRuns.ReplaceAllString(output, "\n\n")
	return output
}

func normalizeCodexCommandResult(item map[string]interface{}, command, output string) string {
	output = sanitizeCodexShellOutput(output)
	toolName, toolInput := adaptCommandAction(item, command)
	if toolName != "Grep" {
		return output
	}
	path, _ := toolInput["path"].(string)
	if path == "" {
		return output
	}
	lines := strings.Split(output, "\n")
	changed := false
	for idx, line := range lines {
		line = strings.TrimRight(line, "\r")
		if line == "" || codexGrepFileLine.MatchString(line) {
			lines[idx] = line
			continue
		}
		if codexGrepLineOnly.MatchString(line) {
			lines[idx] = path + ":" + line
			changed = true
			continue
		}
		lines[idx] = line
	}
	if !changed {
		return output
	}
	return strings.Join(lines, "\n")
}

func (d *Driver) rememberFunctionCallTool(callID, name string, args interface{}) bool {
	if callID == "" || name == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.toolCallNames == nil {
		d.toolCallNames = make(map[string]string)
	}
	d.toolCallNames[callID] = name
	switch name {
	case "write_stdin":
		if targetID := d.terminalTargetForWriteStdinLocked(args); targetID != "" {
			if d.writeStdinTargets == nil {
				d.writeStdinTargets = make(map[string]string)
			}
			d.writeStdinTargets[callID] = targetID
		}
		return true
	}
	return false
}

func (d *Driver) terminalTargetForWriteStdinLocked(args interface{}) string {
	sessionID := codexToolSessionID(args)
	if sessionID == "" {
		return ""
	}
	if d.terminalSessionIDs != nil {
		if targetID := d.terminalSessionIDs[sessionID]; targetID != "" {
			return targetID
		}
	}
	return ""
}

func (d *Driver) rememberFunctionCallOutput(callID, output string) bool {
	if callID == "" || output == "" {
		return false
	}
	sessionID := codexRunningSessionID(output)
	if sessionID == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.toolCallNames == nil || d.toolCallNames[callID] != "exec_command" {
		return false
	}
	if d.terminalSessionIDs == nil {
		d.terminalSessionIDs = make(map[string]string)
	}
	d.terminalSessionIDs[sessionID] = callID
	return true
}

func (d *Driver) eventFunctionCallOutput(callID, output string, localShell bool) *provider.OutputEvent {
	d.rememberFunctionCallOutput(callID, output)
	parsed := parseWaitAgentOutput(output)

	d.mu.Lock()
	targetID := ""
	sourceName := ""
	if d.toolCallNames != nil {
		sourceName = d.toolCallNames[callID]
	}
	if d.writeStdinTargets != nil {
		targetID = d.writeStdinTargets[callID]
	}
	d.mu.Unlock()
	if sourceName == "write_stdin" && targetID == "" {
		return nil
	}

	if localShell || sourceName == "exec_command" || targetID != "" {
		parsed = sanitizeCodexShellOutput(parsed)
	}
	if strings.TrimSpace(parsed) == "" {
		return nil
	}
	if targetID != "" {
		callID = targetID
	}
	return eventToolResult(callID, parsed, false)
}

func codexRunningSessionID(output string) string {
	match := codexSessionIDLine.FindStringSubmatch(output)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func codexToolSessionID(args interface{}) string {
	switch v := args.(type) {
	case string:
		var parsed map[string]interface{}
		if json.Unmarshal([]byte(v), &parsed) == nil {
			return codexToolSessionID(parsed)
		}
	case map[string]interface{}:
		return codexAnyID(v["session_id"])
	}
	return ""
}

func codexAnyID(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatInt(int64(v), 10)
	case float32:
		return strconv.FormatInt(int64(v), 10)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case json.Number:
		return v.String()
	default:
		return ""
	}
}

func (d *Driver) parseCollabAgentCompleted(item map[string]interface{}, params map[string]interface{}) *provider.OutputEvent {
	tool, _ := item["tool"].(string)
	switch tool {
	case "spawnAgent":
		state := d.rememberSubagentSpawn(item)
		return eventSubagentTaskStarted(state)
	case "wait":
		return d.eventSubagentWaitCompleted(item)
	default:
		return nil
	}
}

func (d *Driver) rememberSubagentSpawn(item map[string]interface{}) codexSubagentState {
	id, _ := item["id"].(string)
	prompt, _ := item["prompt"].(string)
	model, _ := item["model"].(string)
	reasoningEffort, _ := item["reasoningEffort"].(string)
	startedAtMs := int64FromAny(item["startedAtMs"])
	input := codexSubagentToolInput(item)
	description, _ := input["description"].(string)
	subagentType, _ := input["subagent_type"].(string)
	state := codexSubagentState{
		CallID:          id,
		Prompt:          prompt,
		Description:     description,
		SubagentType:    subagentType,
		Model:           model,
		ReasoningEffort: reasoningEffort,
		StartedAtMs:     startedAtMs,
	}
	if receiverID := firstReceiverThreadID(item); receiverID != "" {
		state.AgentID = receiverID
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	if d.subagentsByCallID == nil {
		d.subagentsByCallID = make(map[string]codexSubagentState)
	}
	if d.subagentCallByID == nil {
		d.subagentCallByID = make(map[string]string)
	}
	if previous, ok := d.subagentsByCallID[id]; ok {
		state = mergeSubagentState(previous, state)
	}
	d.subagentsByCallID[id] = state
	if state.AgentID != "" {
		d.subagentCallByID[state.AgentID] = id
	}
	return state
}

func (d *Driver) eventSubagentWaitCompleted(item map[string]interface{}) *provider.OutputEvent {
	agentID := firstReceiverThreadID(item)
	spawnCallID := ""
	if agentID != "" {
		d.mu.Lock()
		spawnCallID = d.subagentCallByID[agentID]
		state := d.subagentsByCallID[spawnCallID]
		d.mu.Unlock()
		if spawnCallID != "" {
			output := extractCollabAgentOutput(item)
			isError := collabAgentHasError(item)
			return eventSubagentToolResult(spawnCallID, output, isError, mergeSubagentState(state, codexSubagentState{AgentID: agentID}))
		}
	}
	return nil
}

func (d *Driver) applySubagentScope(ev *provider.OutputEvent, params map[string]interface{}) *provider.OutputEvent {
	if ev == nil || ev.Message == nil {
		return ev
	}
	threadID, _ := params["threadId"].(string)
	if threadID == "" {
		return ev
	}
	d.mu.Lock()
	spawnCallID := d.subagentCallByID[threadID]
	d.mu.Unlock()
	if spawnCallID == "" {
		return ev
	}
	ev.Message["parent_tool_use_id"] = spawnCallID
	ev.Message["task_id"] = threadID
	ev.Message["agentId"] = threadID
	ev.Message["isSidechain"] = true
	return ev
}

func (d *Driver) rememberTurnStarted(params map[string]interface{}) {
	threadID, _ := params["threadId"].(string)
	if threadID == "" {
		return
	}
	turnID, _ := nestedCodexString(params, "turn", "id")
	if turnID == "" {
		turnID, _ = params["turnId"].(string)
	}
	if turnID == "" {
		return
	}
	d.mu.Lock()
	if d.activeTurnByThread == nil {
		d.activeTurnByThread = make(map[string]string)
	}
	d.activeTurnByThread[threadID] = turnID
	d.mu.Unlock()
}

func (d *Driver) rememberTurnCompleted(params map[string]interface{}) {
	threadID, _ := params["threadId"].(string)
	if threadID == "" {
		return
	}
	turnID, _ := params["turnId"].(string)
	if turnID == "" {
		turnID, _ = nestedCodexString(params, "turn", "id")
	}
	d.mu.Lock()
	if turnID == "" || d.activeTurnByThread[threadID] == turnID {
		delete(d.activeTurnByThread, threadID)
	}
	d.mu.Unlock()
}

func (d *Driver) currentActiveTurn(threadID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeTurnByThread[threadID]
}

func (d *Driver) rememberWebActionToolUse(id, key string) bool {
	if id == "" || key == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.webSearchToolUses == nil {
		d.webSearchToolUses = make(map[string]string)
	}
	if d.webSearchToolUses[id] == key {
		return false
	}
	d.webSearchToolUses[id] = key
	return true
}

func (d *Driver) hasWebActionToolUse(id, key string) bool {
	if id == "" || key == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.webSearchToolUses != nil && d.webSearchToolUses[id] == key
}

func nestedCodexString(m map[string]interface{}, key, child string) (string, bool) {
	nested, ok := m[key].(map[string]interface{})
	if !ok {
		return "", false
	}
	value, ok := nested[child].(string)
	return value, ok && value != ""
}

func codexSubagentToolInput(item map[string]interface{}) map[string]interface{} {
	prompt, _ := item["prompt"].(string)
	description := firstNonEmpty(firstSentence(prompt), prompt)
	return map[string]interface{}{
		"prompt":        prompt,
		"subagent_type": mapAgentType(""),
		"description":   description,
	}
}

func codexItemMessageID(params map[string]interface{}) string {
	threadID, _ := params["threadId"].(string)
	turnID, _ := params["turnId"].(string)
	prefix := ""
	if threadID != "" || turnID != "" {
		prefix = threadID + ":" + turnID + ":"
	}
	if itemID, _ := params["itemId"].(string); itemID != "" {
		return prefix + itemID
	}
	item, _ := params["item"].(map[string]interface{})
	if itemID, _ := item["id"].(string); itemID != "" {
		return prefix + itemID
	}
	if turnID != "" {
		return prefix + "agentMessage"
	}
	return ""
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
		return eventResultWithMeta(raw)
	case "thread.completed", "thread.cancelled":
		return eventResultWithMeta(raw)
	case "thread.error", "error", "turn.failed":
		msg, _ := raw["message"].(string)
		return eventError(msg)
	case "message.delta":
		delta, _ := raw["delta"].(string)
		return eventAssistantDelta(codexBatchMessageID(raw), delta)
	case "compacted":
		return eventContextCompacted(raw)
	case "event_msg":
		payload, _ := raw["payload"].(map[string]interface{})
		if payloadType, _ := payload["type"].(string); payloadType == "context_compacted" {
			return eventContextCompacted(raw)
		}
		return &provider.OutputEvent{
			Type:    eventType,
			Message: raw,
		}
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
		return nil
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
		command := extractBatchCommand(item)
		return eventToolResult(id, normalizeCodexCommandResult(item, command, output), isError)
	case "agent_message", "message":
		text, _ := item["text"].(string)
		if strings.TrimSpace(text) == "" {
			return nil
		}
		id, _ := item["id"].(string)
		return eventAssistantText(id, text)
	case "function_call", "custom_tool_call", "local_shell_exec":
		name, _ := item["name"].(string)
		if name == "" {
			name, _ = item["command"].(string)
		}
		id := firstNonEmpty(str(item, "id"), str(item, "call_id"), str(item, "callId"))
		args := extractFunctionCallArgs(item)
		if d.rememberFunctionCallTool(id, name, args) {
			return nil
		}
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return eventToolUse(id, claudeName, claudeInput)
	case "function_call_output", "custom_tool_call_output", "local_shell_output":
		output, _ := item["output"].(string)
		callID := firstNonEmpty(str(item, "call_id"), str(item, "callId"), str(item, "id"))
		return d.eventFunctionCallOutput(callID, output, itemType == "local_shell_output")
	default:
		return nil
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
		if strings.TrimSpace(text) == "" {
			return nil
		}
		if role, _ := payload["role"].(string); role == "user" {
			return &provider.OutputEvent{
				Type:    "user",
				Message: userText(text),
			}
		}
		return eventAssistantText(codexBatchMessageID(raw), text)
	case "function_call", "custom_tool_call":
		name, _ := payload["name"].(string)
		callID := firstNonEmpty(str(payload, "call_id"), str(payload, "callId"), str(payload, "id"))
		args := extractFunctionCallArgs(payload)
		if d.rememberFunctionCallTool(callID, name, args) {
			return nil
		}
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return eventToolUse(callID, claudeName, claudeInput)
	case "function_call_output", "custom_tool_call_output":
		output, _ := payload["output"].(string)
		callID := firstNonEmpty(str(payload, "call_id"), str(payload, "callId"), str(payload, "id"))
		return d.eventFunctionCallOutput(callID, output, false)
	default:
		return nil
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
