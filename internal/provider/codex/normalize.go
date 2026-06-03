package codex

import (
	"encoding/json"
	"strings"

	"ropcode/internal/provider"
)

func init() {
	provider.RegisterHistoryNormalizer("codex", NormalizeHistoryEntry)
}

func NormalizeHistoryEntry(raw map[string]any) provider.OutputEvent {
	eventType := str(raw, "type")

	var msg map[string]any
	var evType, evSubtype string

	switch eventType {
	case "response_item":
		payload := mval(raw["payload"])
		msg = normalizePayloadHistory(payload)
		annotateCodexHistoryMessage(msg, raw, payload)
		evType = historyEventType(raw)
		evSubtype = historySubtype(raw)
	case "item.completed":
		item := mval(raw["item"])
		msg = normalizeItemHistory(item)
		annotateCodexHistoryMessage(msg, raw, item)
		evType = historyEventType(raw)
		evSubtype = historySubtype(raw)
	case "message.delta":
		msg = assistantTextWithID(codexHistoryEventID(raw, nil, true), str(raw, "delta"))
		evType = "assistant"
	case "turn.completed", "thread.completed", "thread.cancelled":
		msg = map[string]any{"type": "result", "subtype": "success"}
		annotateCodexHistoryMessage(msg, raw, nil)
		evType = "assistant"
		evSubtype = "result"
	case "thread.error", "error", "turn.failed":
		msg = map[string]any{"type": "error", "message": str(raw, "message")}
		annotateCodexHistoryMessage(msg, raw, nil)
		evType = "error"
	case "event_msg":
		return normalizeEventMsg(raw)
	case "session_meta":
		evType = "system"
		evSubtype = "init"
		msg = raw
	case "thread.started":
		evType = "system"
		evSubtype = "init"
		msg = raw
	default:
		evType = historyEventType(raw)
		evSubtype = historySubtype(raw)
		msg = raw
	}

	return provider.OutputEvent{
		Type:    evType,
		Subtype: evSubtype,
		Message: msg,
	}
}

func annotateCodexHistoryMessage(msg map[string]any, raw, payload map[string]any) {
	if msg == nil {
		return
	}
	eventID := codexHistoryEventID(raw, payload, false)
	if eventID != "" {
		msg["event_id"] = eventID
	}
	if providerSessionID := firstNonEmpty(str(raw, "session_id"), str(raw, "sessionId"), str(raw, "thread_id"), str(raw, "threadId")); providerSessionID != "" {
		msg["session_id"] = providerSessionID
	}

	message := mval(msg["message"])
	if message == nil {
		return
	}
	if str(message, "id") == "" && eventID != "" && isCodexMessagePayload(payload) {
		message["id"] = eventID
	}
}

func codexHistoryEventID(raw, payload map[string]any, allowSynthetic bool) string {
	if raw == nil {
		raw = map[string]any{}
	}
	if id := firstNonEmpty(
		str(raw, "itemId"),
		str(raw, "item_id"),
		str(raw, "event_id"),
		str(raw, "eventId"),
		str(raw, "id"),
		str(payload, "id"),
		str(payload, "call_id"),
		str(payload, "callId"),
	); id != "" {
		return id
	}
	if allowSynthetic {
		return codexHistoryTurnID(raw, payload)
	}
	return ""
}

func codexHistoryTurnID(raw, payload map[string]any) string {
	threadID := firstNonEmpty(str(raw, "threadId"), str(raw, "thread_id"), str(raw, "threadID"), str(raw, "session_id"))
	turnID := firstNonEmpty(str(raw, "turnId"), str(raw, "turn_id"), str(raw, "turnID"))
	if threadID == "" && turnID == "" {
		return ""
	}
	payloadID := firstNonEmpty(str(payload, "id"), str(payload, "call_id"), str(payload, "callId"), str(raw, "type"))
	return strings.Join([]string{threadID, turnID, payloadID}, ":")
}

func isCodexMessagePayload(payload map[string]any) bool {
	switch str(payload, "type") {
	case "message", "agent_message":
		return true
	default:
		return false
	}
}

func normalizeEventMsg(raw map[string]any) provider.OutputEvent {
	payload := mval(raw["payload"])
	if payload == nil {
		return provider.OutputEvent{Type: "system", Message: raw}
	}
	payloadType := str(payload, "type")

	switch payloadType {
	case "agent_message":
		// Redundant with response_item/message — suppress to avoid duplicates
		return provider.OutputEvent{Type: "system", Subtype: "agent_message"}
	case "agent_reasoning":
		// Redundant with response_item/reasoning — suppress
		return provider.OutputEvent{Type: "system", Subtype: "agent_reasoning"}
	case "user_message":
		// Redundant with response_item/message(role=user) — suppress
		return provider.OutputEvent{Type: "system", Subtype: "user_message"}
	case "task_complete":
		return provider.OutputEvent{
			Type:    "assistant",
			Subtype: "result",
			Message: map[string]any{"type": "result", "subtype": "success"},
		}
	case "task_started":
		return provider.OutputEvent{
			Type:    "system",
			Subtype: "turn_started",
			Message: payload,
		}
	case "token_count":
		info := mval(payload["info"])
		return provider.OutputEvent{
			Type:    "system",
			Subtype: "token_usage",
			Message: map[string]any{
				"type":  "system",
				"usage": normalizeTokenCount(info),
			},
		}
	case "web_search_end":
		return provider.OutputEvent{
			Type:    "system",
			Subtype: "web_search_end",
			Message: payload,
		}
	default:
		return provider.OutputEvent{
			Type:    "system",
			Subtype: payloadType,
			Message: payload,
		}
	}
}

func normalizeTokenCount(info map[string]any) map[string]any {
	if info == nil {
		return nil
	}
	total := mval(info["total_token_usage"])
	if total == nil {
		total = mval(info["last_token_usage"])
	}
	if total == nil {
		return nil
	}
	return map[string]any{
		"input_tokens":            total["input_tokens"],
		"output_tokens":           total["output_tokens"],
		"cache_read_input_tokens": total["cached_input_tokens"],
		"total_tokens":            total["total_tokens"],
	}
}

// adaptToolCall maps Codex tool names/inputs to Claude equivalents.
// This is the SINGLE SOURCE OF TRUTH for all Codex → Claude tool adaptation.
func adaptToolCall(name string, input any) (string, interface{}) {
	var args map[string]interface{}
	switch v := input.(type) {
	case map[string]interface{}:
		args = v
	case string:
		if v != "" {
			if err := json.Unmarshal([]byte(v), &args); err != nil && name == "apply_patch" {
				args = map[string]interface{}{"patch": v}
			}
		}
	}
	if args == nil {
		args = map[string]interface{}{}
	}
	return adaptToolName(name, args)
}

func adaptToolName(toolName string, args map[string]interface{}) (string, interface{}) {
	switch toolName {
	case "shell", "shell_command", "exec_command":
		command, _ := args["command"].(string)
		if command == "" {
			command, _ = args["cmd"].(string)
		}
		return adaptCommandFromString(command)

	case "update_plan":
		return "TodoWrite", adaptPlanToTodos(args)

	case "apply_patch":
		return adaptApplyPatchTool(args)

	case "spawn_agent":
		return "Agent", adaptSpawnAgentInput(args)

	case "wait_agent", "close_agent", "send_input", "resume_agent":
		return "", nil

	case "write_stdin":
		return "", nil

	default:
		return toolName, args
	}
}

type codexPatchOperation struct {
	kind     string
	path     string
	oldLines []string
	newLines []string
}

func adaptApplyPatchTool(args map[string]interface{}) (string, interface{}) {
	patchText := extractApplyPatchText(args)
	if patchText == "" {
		return "Edit", args
	}
	if toolName, input, ok := claudeToolFromApplyPatch(patchText); ok {
		return toolName, input
	}
	return "Bash", map[string]interface{}{
		"command":     "apply_patch",
		"description": "Apply patch",
		"patch":       patchText,
	}
}

func extractApplyPatchText(args map[string]interface{}) string {
	for _, key := range []string{"patch", "input", "content", "diff", "changes"} {
		if text := extractApplyPatchTextValue(args[key]); text != "" {
			return text
		}
	}
	for _, key := range []string{"command", "cmd", "arguments"} {
		if text := extractPatchDocument(extractApplyPatchTextValue(args[key])); text != "" {
			return text
		}
	}
	return ""
}

func extractApplyPatchTextValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case map[string]interface{}:
		return extractApplyPatchText(v)
	default:
		return ""
	}
}

func extractPatchDocument(text string) string {
	if text == "" {
		return ""
	}
	start := strings.Index(text, "*** Begin Patch")
	if start < 0 {
		return ""
	}
	patch := text[start:]
	if end := strings.Index(patch, "*** End Patch"); end >= 0 {
		patch = patch[:end+len("*** End Patch")]
	}
	return strings.TrimSpace(patch)
}

func claudeToolFromApplyPatch(patchText string) (string, map[string]interface{}, bool) {
	operations := parseApplyPatchOperations(patchText)
	if len(operations) == 0 {
		return "", nil, false
	}

	if len(operations) == 1 {
		return claudeToolFromPatchOperation(operations[0], patchText)
	}

	firstPath := operations[0].path
	samePath := firstPath != ""
	edits := make([]map[string]interface{}, 0, len(operations))
	for _, operation := range operations {
		if operation.path != firstPath || operation.kind != "update" {
			samePath = false
			break
		}
		edits = append(edits, map[string]interface{}{
			"old_string": strings.Join(operation.oldLines, "\n"),
			"new_string": strings.Join(operation.newLines, "\n"),
		})
	}
	if samePath && len(edits) > 0 {
		return "MultiEdit", map[string]interface{}{"file_path": firstPath, "edits": edits}, true
	}

	return "Edit", map[string]interface{}{
		"file_path":  firstPath,
		"old_string": patchText,
		"new_string": "",
	}, true
}

func claudeToolFromPatchOperation(operation codexPatchOperation, patchText string) (string, map[string]interface{}, bool) {
	switch operation.kind {
	case "add":
		return "Write", map[string]interface{}{
			"file_path": operation.path,
			"content":   strings.Join(operation.newLines, "\n"),
		}, true
	case "update":
		return "Edit", map[string]interface{}{
			"file_path":  operation.path,
			"old_string": strings.Join(operation.oldLines, "\n"),
			"new_string": strings.Join(operation.newLines, "\n"),
		}, true
	case "delete":
		return "Edit", map[string]interface{}{
			"file_path":  operation.path,
			"old_string": patchText,
			"new_string": "",
		}, true
	default:
		return "", nil, false
	}
}

func parseApplyPatchOperations(patchText string) []codexPatchOperation {
	var operations []codexPatchOperation
	var current *codexPatchOperation

	flush := func() {
		if current != nil && current.path != "" {
			operations = append(operations, *current)
		}
		current = nil
	}

	for _, rawLine := range strings.Split(patchText, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		switch {
		case strings.HasPrefix(line, "*** Update File: "):
			flush()
			current = &codexPatchOperation{kind: "update", path: strings.TrimSpace(strings.TrimPrefix(line, "*** Update File: "))}
			continue
		case strings.HasPrefix(line, "*** Add File: "):
			flush()
			current = &codexPatchOperation{kind: "add", path: strings.TrimSpace(strings.TrimPrefix(line, "*** Add File: "))}
			continue
		case strings.HasPrefix(line, "*** Delete File: "):
			flush()
			current = &codexPatchOperation{kind: "delete", path: strings.TrimSpace(strings.TrimPrefix(line, "*** Delete File: "))}
			continue
		case strings.HasPrefix(line, "*** Move to: "):
			if current != nil {
				current.path = strings.TrimSpace(strings.TrimPrefix(line, "*** Move to: "))
			}
			continue
		}

		if current == nil || strings.HasPrefix(line, "*** ") || strings.HasPrefix(line, "@@") {
			continue
		}

		switch current.kind {
		case "add":
			if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
				current.newLines = append(current.newLines, strings.TrimPrefix(line, "+"))
			}
		case "update":
			switch {
			case strings.HasPrefix(line, " "):
				contextLine := strings.TrimPrefix(line, " ")
				current.oldLines = append(current.oldLines, contextLine)
				current.newLines = append(current.newLines, contextLine)
			case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
				current.oldLines = append(current.oldLines, strings.TrimPrefix(line, "-"))
			case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
				current.newLines = append(current.newLines, strings.TrimPrefix(line, "+"))
			}
		}
	}
	flush()
	return operations
}

// adaptPlanEvent converts a turn/plan/updated notification to a TodoWrite tool_use event.
func adaptPlanEvent(params map[string]interface{}) *provider.OutputEvent {
	plan, _ := params["plan"].([]interface{})
	if len(plan) == 0 {
		return nil
	}
	todos := make([]map[string]interface{}, 0, len(plan))
	for _, item := range plan {
		if stepMap, ok := item.(map[string]interface{}); ok {
			step, _ := stepMap["step"].(string)
			status, _ := stepMap["status"].(string)
			if status == "inProgress" {
				status = "in_progress"
			}
			activeForm := step
			if status == "in_progress" {
				activeForm = step + "..."
			}
			todos = append(todos, map[string]interface{}{
				"content":    step,
				"status":     status,
				"activeForm": activeForm,
			})
		}
	}
	turnID, _ := params["turnId"].(string)
	return &provider.OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{
					{"type": "tool_use", "id": "plan_" + turnID, "name": "TodoWrite", "input": map[string]interface{}{"todos": todos}},
				},
			},
		},
	}
}

// adaptCommandAction maps a commandExecution item to the appropriate Claude tool
// based on commandActions[0].type (live) or command string parsing (history fallback).
func adaptCommandAction(item map[string]interface{}, command string) (string, map[string]interface{}) {
	actions, _ := item["commandActions"].([]interface{})
	if len(actions) > 0 {
		action, _ := actions[0].(map[string]interface{})
		if action != nil {
			return adaptCommandActionFromMeta(action, command)
		}
	}
	// Fallback: parse command string to detect tool type
	return adaptCommandFromString(command)
}

func adaptCommandActionFromMeta(action map[string]interface{}, command string) (string, map[string]interface{}) {
	actionType, _ := action["type"].(string)
	switch actionType {
	case "read":
		filePath, _ := action["path"].(string)
		name, _ := action["name"].(string)
		desc := "Read " + name
		if filePath != "" {
			return "Read", map[string]interface{}{"file_path": filePath, "description": desc}
		}
		return "Read", map[string]interface{}{"command": command, "description": desc}
	case "search":
		query := strings.TrimSpace(stringFromAction(action, "query"))
		path := strings.TrimSpace(stringFromAction(action, "path"))
		actionCommand := firstNonEmpty(stringFromAction(action, "command"), command)
		if query == "" {
			toolName, toolInput := adaptCommandFromString(actionCommand)
			if toolName == "Grep" {
				if path != "" {
					if parsedPath, _ := toolInput["path"].(string); parsedPath == "" {
						toolInput["path"] = path
					}
				}
				if pattern, _ := toolInput["pattern"].(string); pattern != "" {
					toolInput["description"] = "Search: " + pattern
					toolInput["output_mode"] = "content"
				}
			}
			return toolName, toolInput
		}
		return "Grep", map[string]interface{}{
			"pattern":     query,
			"path":        path,
			"command":     actionCommand,
			"description": "Search: " + query,
			"output_mode": "content",
		}
	case "listFiles":
		path := strings.TrimSpace(stringFromAction(action, "path"))
		actionCommand := firstNonEmpty(stringFromAction(action, "command"), command)
		pattern := codexListFilesPattern(actionCommand, path)
		return "Glob", map[string]interface{}{
			"pattern":     pattern,
			"path":        path,
			"command":     actionCommand,
			"description": "List files in " + path,
		}
	default:
		return "Bash", map[string]interface{}{"command": command, "description": command}
	}
}

func stringFromAction(action map[string]interface{}, key string) string {
	value, _ := action[key].(string)
	return value
}

func codexListFilesPattern(command, path string) string {
	fields := strings.Fields(command)
	for i, field := range fields {
		if (field == "-g" || field == "--glob") && i+1 < len(fields) {
			return strings.Trim(fields[i+1], "'\"")
		}
	}
	if path != "" {
		return path
	}
	return "*"
}

func adaptCommandFromString(command string) (string, map[string]interface{}) {
	// Strip "cd ... && " prefix for analysis
	cmd := command
	if idx := strings.Index(cmd, " && "); idx > 0 && strings.HasPrefix(cmd, "cd ") {
		cmd = cmd[idx+4:]
	}

	switch {
	case strings.HasPrefix(cmd, "rg --files") || strings.HasPrefix(cmd, "rg -l"):
		pattern, path := parseRgFilesCommand(cmd)
		return "Glob", map[string]interface{}{"pattern": pattern, "path": path, "command": command, "description": cmd}
	case strings.HasPrefix(cmd, "rg ") || strings.HasPrefix(cmd, "grep "):
		pattern, path := parseGrepCommand(cmd)
		if pattern == "" {
			return "Bash", map[string]interface{}{"command": command, "description": cmd}
		}
		return "Grep", map[string]interface{}{"pattern": pattern, "path": path, "command": command}
	case strings.HasPrefix(cmd, "find "):
		pattern, path := parseFindCommand(cmd)
		return "Glob", map[string]interface{}{"pattern": pattern, "path": path, "command": command}
	case strings.HasPrefix(cmd, "cat "):
		filePath := strings.TrimSpace(strings.TrimPrefix(cmd, "cat "))
		return "Read", map[string]interface{}{"file_path": filePath}
	case strings.HasPrefix(cmd, "sed -n "):
		filePath := parseSedReadTarget(cmd)
		return "Read", map[string]interface{}{"file_path": filePath, "command": command}
	case strings.HasPrefix(cmd, "head ") || strings.HasPrefix(cmd, "tail "):
		filePath := parseHeadTailTarget(cmd)
		return "Read", map[string]interface{}{"file_path": filePath, "command": command}
	case strings.HasPrefix(cmd, "ls"):
		path := extractCdPath(command)
		parts := strings.Fields(cmd)
		for _, p := range parts[1:] {
			if !strings.HasPrefix(p, "-") {
				path = p
				break
			}
		}
		return "LS", map[string]interface{}{"path": path, "command": command}
	default:
		return "Bash", map[string]interface{}{"command": command, "description": cmd}
	}
}

func parseRgFilesCommand(cmd string) (string, string) {
	parts := strings.Fields(cmd)
	pattern := "*"
	path := ""
	for i := 1; i < len(parts); i++ {
		part := parts[i]
		switch part {
		case "-g", "--glob":
			if i+1 < len(parts) {
				pattern = strings.Trim(parts[i+1], "'\"")
				i++
			}
		default:
			if strings.HasPrefix(part, "-") {
				continue
			}
			path = strings.Trim(part, "'\"")
		}
	}
	return pattern, path
}

func parseGrepCommand(cmd string) (string, string) {
	// Extract pattern and path from: rg [-flags] 'pattern' [path]
	// Handle quoted patterns: rg -n "openclaw|open_claw" file.go
	var pattern, path string

	// Try to find quoted pattern first
	for _, quote := range []byte{'"', '\''} {
		start := strings.IndexByte(cmd, quote)
		if start >= 0 {
			end := strings.IndexByte(cmd[start+1:], quote)
			if end >= 0 {
				pattern = cmd[start+1 : start+1+end]
				// Path is after the closing quote
				rest := strings.TrimSpace(cmd[start+1+end+1:])
				if rest != "" {
					fields := strings.Fields(rest)
					for _, f := range fields {
						if !strings.HasPrefix(f, "-") {
							path = f
							break
						}
					}
				}
				return pattern, path
			}
		}
	}

	// Fallback: parse by fields
	parts := strings.Fields(cmd)
	skipNext := false
	for i := 1; i < len(parts); i++ {
		if skipNext {
			skipNext = false
			continue
		}
		p := parts[i]
		if strings.HasPrefix(p, "-") {
			if p == "-g" || p == "-t" || p == "--type" || p == "-C" || p == "-A" || p == "-B" || p == "-e" {
				skipNext = true
			}
			continue
		}
		if pattern == "" {
			pattern = p
		} else if path == "" {
			path = p
		}
	}
	return pattern, path
}

func parseFindCommand(cmd string) (string, string) {
	// Extract from: find PATH -name "PATTERN"
	parts := strings.Fields(cmd)
	var path, pattern string
	if len(parts) > 1 {
		path = parts[1]
	}
	for i, p := range parts {
		if p == "-name" && i+1 < len(parts) {
			pattern = strings.Trim(parts[i+1], "'\"")
			break
		}
	}
	return pattern, path
}

func parseSedReadTarget(cmd string) string {
	// Extract file from: sed -n '1,80p' FILE
	parts := strings.Fields(cmd)
	if len(parts) >= 3 {
		return parts[len(parts)-1]
	}
	return ""
}

func parseHeadTailTarget(cmd string) string {
	// Extract file from: head -n 10 FILE or tail FILE
	parts := strings.Fields(cmd)
	if len(parts) >= 2 {
		return parts[len(parts)-1]
	}
	return ""
}

func extractCdPath(command string) string {
	if !strings.HasPrefix(command, "cd ") {
		return "."
	}
	idx := strings.Index(command, " && ")
	if idx < 0 {
		return strings.TrimSpace(command[3:])
	}
	return strings.TrimSpace(command[3:idx])
}

// formatDirectoryListing converts plain ls output to the "- file/" format
// expected by the frontend LS widget.
func formatDirectoryListing(output string) string {
	lines := strings.Split(output, "\n")
	var formatted []string
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		formatted = append(formatted, "- "+line)
	}
	return strings.Join(formatted, "\n")
}

// extractAgentResult extracts the result text from a collabAgentToolCall item.
// Used by both live (output_parser) and history paths to produce consistent tool_result content.
func extractAgentResult(item map[string]interface{}) string {
	// 1. Check agentsStates[threadId].message (live completed event)
	states, _ := item["agentsStates"].(map[string]interface{})
	for _, state := range states {
		if s, ok := state.(map[string]interface{}); ok {
			if msg, ok := s["message"].(string); ok && msg != "" {
				return msg
			}
		}
	}
	// 2. Check output field
	output, _ := item["output"].(string)
	if output != "" {
		return output
	}
	// 3. Default spawn acknowledgment (same as history's function_call_output content)
	tool, _ := item["tool"].(string)
	if tool == "spawnAgent" {
		return "Full-history forked agents inherit the parent agent type, model, and reasoning effort; omit agent_type, model, and reasoning_effort, or spawn without a full-history fork."
	}
	return "Agent spawned"
}

func firstReceiverThreadID(item map[string]interface{}) string {
	ids, _ := item["receiverThreadIds"].([]interface{})
	for _, raw := range ids {
		if id, ok := raw.(string); ok && id != "" {
			return id
		}
	}
	return ""
}

func mergeSubagentState(base, next codexSubagentState) codexSubagentState {
	if next.CallID != "" {
		base.CallID = next.CallID
	}
	if next.AgentID != "" {
		base.AgentID = next.AgentID
	}
	if next.Prompt != "" {
		base.Prompt = next.Prompt
	}
	if next.Description != "" {
		base.Description = next.Description
	}
	if next.SubagentType != "" {
		base.SubagentType = next.SubagentType
	}
	if next.Model != "" {
		base.Model = next.Model
	}
	if next.ReasoningEffort != "" {
		base.ReasoningEffort = next.ReasoningEffort
	}
	if next.StartedAtMs != 0 {
		base.StartedAtMs = next.StartedAtMs
	}
	return base
}

func collabAgentHasError(item map[string]interface{}) bool {
	states, _ := item["agentsStates"].(map[string]interface{})
	for _, state := range states {
		stateMap, _ := state.(map[string]interface{})
		status, _ := stateMap["status"].(string)
		switch strings.ToLower(status) {
		case "error", "failed", "failure", "cancelled", "canceled":
			return true
		}
	}
	return false
}

func firstSentence(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	for _, sep := range []string{". ", "\n", "。", "！", "？"} {
		if idx := strings.Index(trimmed, sep); idx > 0 {
			return strings.TrimSpace(trimmed[:idx])
		}
	}
	if len(trimmed) > 120 {
		return strings.TrimSpace(trimmed[:120])
	}
	return trimmed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func int64FromAny(value interface{}) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	default:
		return 0
	}
}

func adaptSpawnAgentInput(args map[string]interface{}) map[string]interface{} {
	prompt, _ := args["message"].(string)
	if prompt == "" {
		prompt, _ = args["prompt"].(string)
	}
	agentType, _ := args["agent_type"].(string)
	subagentType := mapAgentType(agentType)
	return map[string]interface{}{
		"prompt":        prompt,
		"subagent_type": subagentType,
		"description":   prompt,
	}
}

func mapAgentType(codexType string) string {
	switch codexType {
	case "explorer":
		return "Explore"
	case "worker":
		return "general-purpose"
	default:
		return "general-purpose"
	}
}

func parseSubagentNotification(text string) map[string]any {
	// Extract JSON between <subagent_notification> tags
	start := strings.Index(text, "<subagent_notification>")
	end := strings.Index(text, "</subagent_notification>")
	if start < 0 || end < 0 {
		return nil
	}
	jsonStr := strings.TrimSpace(text[start+len("<subagent_notification>") : end])

	var notification map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &notification); err != nil {
		return nil
	}

	agentPath, _ := notification["agent_path"].(string)
	content := ""
	if status, ok := notification["status"].(map[string]interface{}); ok {
		if completed, ok := status["completed"].(string); ok {
			content = completed
		}
	}
	if content == "" {
		return nil
	}

	return map[string]any{
		"type":               "assistant",
		"isSidechain":        true,
		"parent_tool_use_id": agentPath,
		"message": map[string]any{
			"role": "assistant",
			"content": []interface{}{
				map[string]any{"type": "text", "text": content},
			},
		},
	}
}

// parseWaitAgentOutput detects wait_agent and spawn_agent acknowledgment outputs.
// Returns empty string to suppress them from main conversation.
func parseWaitAgentOutput(output string) string {
	if output == "" {
		return ""
	}
	// Try to parse as JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(output), &parsed); err == nil {
		// wait_agent pattern: {"status":{...}, "timed_out":...}
		_, hasStatus := parsed["status"]
		_, hasTimedOut := parsed["timed_out"]
		if hasStatus || hasTimedOut {
			return ""
		}
		// spawn_agent JSON acknowledgment: {"agent_id":"...", "nickname":"..."}
		// Return brief text so frontend marks spawn as completed
		if _, hasAgentID := parsed["agent_id"]; hasAgentID {
			nickname, _ := parsed["nickname"].(string)
			if nickname != "" {
				return "Agent spawned: " + nickname
			}
			return "Agent spawned"
		}
	}
	// Strip metadata prefix from exec_command outputs
	output = stripCommandOutputMetadata(output)
	// Text outputs pass through
	return output
}

// stripCommandOutputMetadata removes the "Chunk ID: ... Output:\n" prefix
// that Codex adds to stored function_call_output content.
func stripCommandOutputMetadata(output string) string {
	if !strings.HasPrefix(output, "Chunk ID:") {
		return output
	}
	idx := strings.Index(output, "Output:\n")
	if idx < 0 {
		return output
	}
	return output[idx+len("Output:\n"):]
}

// isStderrNoise returns true for stderr messages that should be suppressed
// (not real errors, just Codex runtime noise).
func isStderrNoise(message string) bool {
	return strings.Contains(message, "Full-history forked agents") ||
		strings.Contains(message, "write_stdin failed") ||
		strings.Contains(message, "rerun exec_command with tty=true") ||
		strings.Contains(message, "invalid agent id")
}

// isStderrWarning returns true for stderr messages that should be downgraded
// from error to warning (informational, not actionable errors).
func isStderrWarning(message string) bool {
	return false
}

func adaptPlanToTodos(args map[string]interface{}) map[string]interface{} {
	if tasks, ok := args["tasks"].([]interface{}); ok {
		return convertTasksToTodos(tasks)
	}
	if plan, ok := args["plan"].([]interface{}); ok {
		return convertPlanToTodos(plan)
	}
	return map[string]interface{}{"todos": []interface{}{}}
}

func convertTasksToTodos(tasks []interface{}) map[string]interface{} {
	todos := make([]map[string]interface{}, 0, len(tasks))
	for _, task := range tasks {
		if taskMap, ok := task.(map[string]interface{}); ok {
			description, _ := taskMap["description"].(string)
			status, _ := taskMap["status"].(string)
			if status == "" {
				status = "pending"
			}
			todos = append(todos, map[string]interface{}{
				"content":    description,
				"status":     status,
				"activeForm": generateActiveForm(description),
			})
		}
	}
	return map[string]interface{}{"todos": todos}
}

func convertPlanToTodos(plan []interface{}) map[string]interface{} {
	todos := make([]map[string]interface{}, 0, len(plan))
	for _, item := range plan {
		if stepMap, ok := item.(map[string]interface{}); ok {
			step, _ := stepMap["step"].(string)
			status, _ := stepMap["status"].(string)
			if status == "" {
				status = "pending"
			}
			activeForm := step
			if status == "in_progress" {
				activeForm = step + "..."
			}
			todos = append(todos, map[string]interface{}{
				"content":    step,
				"status":     status,
				"activeForm": activeForm,
			})
		}
	}
	return map[string]interface{}{"todos": todos}
}

func generateActiveForm(description string) string {
	trimmed := strings.TrimSpace(description)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, " ", 2)
	firstWord := parts[0]
	rest := ""
	if len(parts) > 1 {
		rest = parts[1]
	}
	verbMap := map[string]string{
		"create": "Creating", "add": "Adding", "update": "Updating",
		"fix": "Fixing", "remove": "Removing", "delete": "Deleting",
		"implement": "Implementing", "write": "Writing", "read": "Reading",
		"build": "Building", "test": "Testing", "run": "Running",
		"check": "Checking", "install": "Installing", "configure": "Configuring",
		"setup": "Setting up", "set": "Setting up", "modify": "Modifying",
		"refactor": "Refactoring", "debug": "Debugging", "analyze": "Analyzing",
		"review": "Reviewing", "merge": "Merging", "deploy": "Deploying",
		"migrate": "Migrating", "optimize": "Optimizing", "validate": "Validating",
		"verify": "Verifying", "ensure": "Ensuring",
	}
	lowerWord := strings.ToLower(firstWord)
	if activeVerb, ok := verbMap[lowerWord]; ok {
		if rest != "" {
			return activeVerb + " " + rest
		}
		return activeVerb
	}
	if strings.HasSuffix(firstWord, "e") && !strings.HasSuffix(firstWord, "ee") {
		base := firstWord[:len(firstWord)-1]
		if rest != "" {
			return base + "ing " + rest
		}
		return base + "ing"
	} else if len(firstWord) > 2 {
		if rest != "" {
			return firstWord + "ing " + rest
		}
		return firstWord + "ing"
	}
	return trimmed
}

func extractFunctionCallArgs(item map[string]interface{}) interface{} {
	if argsStr, ok := item["arguments"].(string); ok && argsStr != "" {
		return argsStr
	}
	if argsMap, ok := item["arguments"].(map[string]interface{}); ok {
		return argsMap
	}
	if _, hasPlan := item["plan"]; hasPlan {
		return item
	}
	return item
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
		payload := mval(raw["payload"])
		if str(payload, "type") == "message" && str(payload, "role") == "user" {
			return "user"
		}
		payloadType := str(payload, "type")
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
		role := str(payload, "role")
		if role == "developer" || role == "system" {
			return nil
		}
		text := payloadText(payload)
		// subagent_notification — emit as sidechain message for subagent panel
		if role == "user" && strings.Contains(text, "<subagent_notification>") {
			return parseSubagentNotification(text)
		}
		if role == "user" {
			return userText(text)
		}
		return assistantText(text)
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
		name := str(payload, "name")
		callID := str(payload, "call_id")
		claudeName, claudeInput := adaptToolCall(name, extractFunctionCallArgs(payload))
		if claudeName == "" {
			return nil
		}
		return toolUse(callID, claudeName, claudeInput)
	case "function_call_output", "custom_tool_call_output":
		output := str(payload, "output")
		callID := str(payload, "call_id")
		parsed := parseWaitAgentOutput(output)
		if parsed == "" {
			return nil
		}
		return toolResult(callID, parsed)
	case "web_search_call":
		id := str(payload, "id")
		if id == "" {
			id = "ws_" + str(payload, "call_id")
		}
		toolName, input, _ := codexWebActionTool(payload)
		if toolName == "" {
			return nil
		}
		return toolUse(id, toolName, input)
	case "tool_search_call", "tool_search_output":
		return nil
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
		id := str(item, "id")
		argsStr := str(item, "arguments")
		var args interface{} = argsStr
		if argsStr == "" {
			args = item
		}
		claudeName, claudeInput := adaptToolCall(name, args)
		if claudeName == "" {
			return nil
		}
		return toolUse(id, claudeName, claudeInput)
	case "function_call_output", "local_shell_output":
		return toolResult(str(item, "id"), str(item, "output"))
	case "web_search_call", "webSearch":
		toolName, input, _ := codexWebActionTool(item)
		if toolName == "" {
			return nil
		}
		id := str(item, "id")
		if id == "" {
			id = "ws_" + str(item, "call_id")
		}
		return toolUseWithResult(id, toolName, input, codexWebActionResultText(toolName, input), false)
	default:
		return nil
	}
}

func codexWebActionTool(item map[string]any) (string, map[string]any, string) {
	action := mval(item["action"])
	actionType := str(action, "type")
	switch actionType {
	case "", "other":
		query := codexWebSearchQuery(item)
		if query == "" {
			return "", nil, ""
		}
		input := map[string]any{"query": query}
		if queries := codexWebSearchQueries(item); len(queries) > 0 {
			input["queries"] = queries
		}
		return "WebSearch", input, "search:" + query
	case "search":
		query := codexWebSearchQuery(item)
		if query == "" {
			return "", nil, ""
		}
		input := map[string]any{"query": query}
		if queries := codexWebSearchQueries(item); len(queries) > 0 {
			input["queries"] = queries
		}
		return "WebSearch", input, "search:" + query
	case "open_page":
		url := str(action, "url")
		if url == "" {
			return "", nil, ""
		}
		return "WebFetch", map[string]any{"url": url}, "fetch:" + url
	case "find_in_page":
		url := str(action, "url")
		pattern := str(action, "pattern")
		if url == "" && pattern == "" {
			return "", nil, ""
		}
		input := map[string]any{"url": url}
		if pattern != "" {
			input["prompt"] = pattern
		}
		return "WebFetch", input, "find:" + url + ":" + pattern
	default:
		query := codexWebSearchQuery(item)
		if query == "" {
			return "", nil, ""
		}
		return "WebSearch", map[string]any{"query": query}, "search:" + query
	}
}

func codexWebSearchQuery(item map[string]any) string {
	if query := strings.TrimSpace(str(item, "query")); query != "" {
		return query
	}
	action := mval(item["action"])
	if query := strings.TrimSpace(str(action, "query")); query != "" {
		return query
	}
	for _, query := range codexWebSearchQueries(item) {
		if query != "" {
			return query
		}
	}
	return ""
}

func codexWebSearchQueries(item map[string]any) []string {
	action := mval(item["action"])
	raw := sval(action["queries"])
	if len(raw) == 0 {
		raw = sval(item["queries"])
	}
	queries := make([]string, 0, len(raw))
	for _, value := range raw {
		query, _ := value.(string)
		query = strings.TrimSpace(query)
		if query != "" {
			queries = append(queries, query)
		}
	}
	return queries
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
	return assistantTextWithID("", text)
}

func assistantTextWithID(messageID, text string) map[string]any {
	message := map[string]any{
		"role":    "assistant",
		"content": []interface{}{map[string]any{"type": "text", "text": text}},
	}
	if messageID != "" {
		message["id"] = messageID
	}
	return map[string]any{
		"type":    "assistant",
		"message": message,
	}
}

func userText(text string) map[string]any {
	return map[string]any{
		"type": "user",
		"message": map[string]any{
			"role": "user",
			"content": []interface{}{
				map[string]any{"type": "text", "text": text},
			},
		},
	}
}

func toolUse(id, name string, input any) map[string]any {
	return map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role":    "assistant",
			"content": []interface{}{map[string]any{"type": "tool_use", "id": id, "name": name, "input": input}},
		},
	}
}

func toolUseWithResult(id, name string, input any, result string, isError bool) map[string]any {
	return map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"role": "assistant",
			"content": []interface{}{
				map[string]any{"type": "tool_use", "id": id, "name": name, "input": input},
				map[string]any{"type": "tool_result", "tool_use_id": id, "content": result, "is_error": isError},
			},
		},
	}
}

func toolResult(toolUseID, content string) map[string]any {
	return map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": []interface{}{map[string]any{"type": "tool_result", "tool_use_id": toolUseID, "content": content}},
		},
	}
}

// --- OutputEvent constructors (used by output_parser.go) ---

func eventAssistantText(messageID, text string) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type:    "assistant",
		Message: assistantTextWithID(messageID, text),
	}
}

func eventAssistantDelta(messageID, text string) *provider.OutputEvent {
	message := map[string]interface{}{
		"role": "assistant",
		"content": []map[string]interface{}{
			{"type": "text", "text": text},
		},
	}
	if messageID != "" {
		message["id"] = messageID
	}
	return &provider.OutputEvent{
		Type:    "assistant",
		IsDelta: true,
		Message: map[string]interface{}{
			"type":    "assistant",
			"message": message,
		},
	}
}

func eventThinking(text string) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{
					{"type": "thinking", "thinking": text},
				},
			},
		},
	}
}

func eventToolUse(id, name string, input interface{}) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{
					{"type": "tool_use", "id": id, "name": name, "input": input},
				},
			},
		},
	}
}

func eventToolUseWithResult(id, name string, input interface{}, result string, isError bool) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "assistant",
		Message: map[string]interface{}{
			"type": "assistant",
			"message": map[string]interface{}{
				"role": "assistant",
				"content": []map[string]interface{}{
					{"type": "tool_use", "id": id, "name": name, "input": input},
					{"type": "tool_result", "tool_use_id": id, "content": result, "is_error": isError},
				},
			},
		},
	}
}

func eventToolResult(toolUseID, content string, isError bool) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "user",
		Message: map[string]interface{}{
			"type": "user",
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "tool_result", "tool_use_id": toolUseID, "content": content, "is_error": isError},
				},
			},
		},
	}
}

func codexWebActionResultText(toolName string, input map[string]any) string {
	switch toolName {
	case "WebFetch":
		if url, _ := input["url"].(string); url != "" {
			return "Page opened: " + url
		}
		return "Page opened"
	case "WebSearch":
		if query, _ := input["query"].(string); query != "" {
			return "Search completed: " + query
		}
		return "Search completed"
	default:
		return "Completed"
	}
}

func eventSubagentTaskStarted(state codexSubagentState) *provider.OutputEvent {
	if state.AgentID == "" || state.CallID == "" {
		return nil
	}
	return &provider.OutputEvent{
		Type:    "system",
		Subtype: "task_started",
		Message: map[string]interface{}{
			"type":        "system",
			"subtype":     "task_started",
			"task_id":     state.AgentID,
			"tool_use_id": state.CallID,
			"description": firstNonEmpty(state.Description, state.Prompt, state.AgentID),
			"task_type":   "local_agent",
			"prompt":      state.Prompt,
			"agentId":     state.AgentID,
		},
	}
}

func eventSubagentToolResult(toolUseID, content string, isError bool, state codexSubagentState) *provider.OutputEvent {
	if toolUseID == "" {
		return nil
	}
	if content == "" {
		content = "Agent completed"
	}
	textBlocks := []map[string]interface{}{
		{"type": "text", "text": content},
	}
	if state.AgentID != "" {
		textBlocks = append(textBlocks, map[string]interface{}{
			"type": "text",
			"text": "agentId: " + state.AgentID,
		})
	}
	resultStatus := "completed"
	if isError {
		resultStatus = "failed"
	}
	return &provider.OutputEvent{
		Type: "user",
		Message: map[string]interface{}{
			"type": "user",
			"message": map[string]interface{}{
				"role": "user",
				"content": []map[string]interface{}{
					{
						"type":        "tool_result",
						"tool_use_id": toolUseID,
						"content":     textBlocks,
						"is_error":    isError,
					},
				},
			},
			"tool_use_result": map[string]interface{}{
				"status":            resultStatus,
				"prompt":            state.Prompt,
				"agentId":           state.AgentID,
				"agentType":         firstNonEmpty(state.SubagentType, "general-purpose"),
				"content":           textBlocks[:1],
				"totalToolUseCount": 0,
			},
		},
	}
}

func eventResult() *provider.OutputEvent {
	return eventResultWithMeta(nil)
}

func eventResultWithMeta(meta map[string]interface{}) *provider.OutputEvent {
	message := map[string]interface{}{
		"type":    "result",
		"subtype": "success",
	}
	if eventID := codexLiveEventID(meta); eventID != "" {
		message["event_id"] = eventID
	}
	return &provider.OutputEvent{
		Type:    "assistant",
		Subtype: "result",
		Message: message,
	}
}

func codexLiveEventID(meta map[string]interface{}) string {
	if meta == nil {
		return ""
	}
	item := mval(meta["item"])
	turn := mval(meta["turn"])
	threadID := firstNonEmpty(str(meta, "threadId"), str(meta, "thread_id"), str(meta, "threadID"))
	turnID := firstNonEmpty(str(meta, "turnId"), str(meta, "turn_id"), str(meta, "turnID"), str(turn, "id"))
	return firstNonEmpty(
		str(meta, "itemId"),
		str(meta, "item_id"),
		str(meta, "event_id"),
		str(meta, "eventId"),
		str(meta, "id"),
		str(item, "id"),
		str(item, "call_id"),
		str(item, "callId"),
		codexLiveScopedID(threadID, turnID, firstNonEmpty(str(item, "type"), str(meta, "type"), str(meta, "method"))),
	)
}

func codexBatchMessageID(raw map[string]interface{}) string {
	payload := mval(raw["payload"])
	return codexLiveEventID(map[string]interface{}{
		"item":     payload,
		"itemId":   firstNonEmpty(str(raw, "itemId"), str(raw, "item_id")),
		"threadId": firstNonEmpty(str(raw, "threadId"), str(raw, "thread_id")),
		"turnId":   firstNonEmpty(str(raw, "turnId"), str(raw, "turn_id")),
		"type":     str(raw, "type"),
	})
}

func codexLiveScopedID(threadID, turnID, suffix string) string {
	if threadID == "" && turnID == "" {
		return ""
	}
	return strings.Join([]string{threadID, turnID, suffix}, ":")
}

func eventError(message string) *provider.OutputEvent {
	return &provider.OutputEvent{
		Type: "error",
		Message: map[string]interface{}{
			"type":    "error",
			"message": message,
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
