package stream

import (
	"fmt"
	"strings"

	"ropcode/internal/provider"
)

func AdaptUnifiedOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	providerID := firstNonEmpty(ctx.Provider, event.Provider)
	runtimeSessionID := firstNonEmpty(ctx.RuntimeSessionID, event.SessionID)
	if runtimeSessionID == "" {
		return SessionFrame{}, ErrMissingProviderRuntimeSession
	}

	raw := copyRaw(event.Message)
	if event.Raw != "" {
		raw["raw"] = event.Raw
	}
	streamID := StreamIDForSession(providerID, runtimeSessionID)
	frame := SessionFrame{
		StreamID:          streamID,
		MessageID:         messageIDFromProviderMessage(event.Message),
		Provider:          providerID,
		RuntimeSessionID:  runtimeSessionID,
		ProviderSessionID: firstNonEmpty(ctx.ProviderSessionID, event.ProviderSessionID, stringFromMap(event.Message, "session_id"), stringFromMap(event.Message, "sessionId")),
		Cwd:               firstNonEmpty(ctx.Cwd, stringFromMap(event.Message, "cwd")),
		ProjectPath:       ctx.ProjectPath,
		Seq:               seq,
		Timestamp:         firstNonEmpty(stringFromMap(event.Message, "timestamp"), nowTimestamp()),
		Kind:              kindFromProviderOutput(event),
		Role:              roleFromProviderOutput(event),
		Subtype:           firstNonEmpty(event.Subtype, stringFromMap(event.Message, "subtype")),
		Content:           extractContentBlocks(event.Message),
		ParentToolUseID:   stringFromMap(event.Message, "parent_tool_use_id"),
		TaskID:            stringFromMap(event.Message, "task_id"),
		ToolUseID:         stringFromMap(event.Message, "tool_use_id"),
		Meta:              Meta{Raw: raw},
	}

	if taskID := taskNotificationID(event.Message); taskID != "" {
		frame.TaskID = firstNonEmpty(frame.TaskID, taskID)
		frame.AgentID = firstNonEmpty(frame.AgentID, taskID)
	}
	frame.Sidechain = boolFromAny(event.Message["isSidechain"]) ||
		frame.ParentToolUseID != "" ||
		frame.TaskID != "" ||
		isBackgroundTaskControlFrame(event.Message, frame.Content)
	if agentID := stringFromMap(event.Message, "agentId"); agentID != "" {
		frame.AgentID = agentID
	}
	if frame.TaskID != "" {
		frame.AgentID = frame.TaskID
	}
	frame.applyContentIDs()

	// Claude-specific metadata enrichment (no-op for other providers)
	frame.applyRuntimeState(event.Message)
	frame.applyTaskProgress(event.Message)
	frame.applyToolUseResult(event.Message)

	// Unified result/error handling
	frame.applyResult(event.Message)
	frame.applyTerminalTurn(event)
	frame.applyErrorContent(event)

	if frame.Usage == nil {
		frame.Usage = extractUsage(firstMap(mapFromAny(event.Message["usage"]), mapFromAny(mapFromAny(event.Message["message"])["usage"])))
	}
	frame.refreshStableFrameID()
	return frame, nil
}

func (f *SessionFrame) refreshStableFrameID() {
	f.FrameID = stableFrameID(f.StreamID, *f)
}

func (f *SessionFrame) applyContentIDs() {
	for _, block := range f.Content {
		switch block.Type {
		case ContentToolUse:
			if f.ToolUseID == "" {
				f.ToolUseID = block.ToolUseID
			}
		case ContentToolResult:
			if f.ToolUseID == "" {
				f.ToolUseID = block.ToolUseID
			}
			if f.ParentToolUseID == "" {
				f.ParentToolUseID = block.ToolUseID
			}
		}
	}
}

func messageIDFromProviderMessage(raw map[string]any) string {
	message := mapFromAny(raw["message"])
	return firstNonEmpty(
		stringFromMap(message, "id"),
		stringFromMap(message, "uuid"),
		stringFromMap(message, "message_id"),
		stringFromMap(message, "messageId"),
		stringFromMap(raw, "message_id"),
		stringFromMap(raw, "messageId"),
		stringFromMap(raw, "uuid"),
		stringFromMap(raw, "id"),
	)
}

func (f *SessionFrame) applyErrorContent(event provider.OutputEvent) {
	if event.Type != "error" {
		return
	}
	f.Kind = FrameKindError
	f.IsError = true
	success := false
	f.Success = &success
	if msg := stringFromMap(event.Message, "message"); msg != "" && len(f.Content) == 0 {
		f.Error = msg
		f.Content = []ContentBlock{{Type: ContentError, Text: msg}}
	}
}

func AdaptClaudeOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	return AdaptUnifiedOutput(ctx, event, seq)
}

func AdaptCodexOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	return AdaptUnifiedOutput(ctx, event, seq)
}

func AdaptDeepSeekOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	return AdaptUnifiedOutput(ctx, event, seq)
}

func (f *SessionFrame) applyRuntimeState(raw map[string]any) {
	debugMeta := mapFromAny(raw["debug_meta"])
	runtimeState := mapFromAny(debugMeta["runtime_state"])
	phase := stringFromMap(runtimeState, "phase")
	if phase == "" {
		phase = stringFromMap(debugMeta, "runtime_state")
	}
	if phase == "" {
		return
	}
	f.Runtime = &RuntimeSnapshot{
		Phase:        phase,
		ActiveTool:   firstNonEmpty(stringFromMap(runtimeState, "active_tool"), stringFromMap(runtimeState, "activeTool")),
		ProgressText: firstNonEmpty(stringFromMap(runtimeState, "progress_text"), stringFromMap(runtimeState, "progressText")),
		WaitingOn:    firstNonEmpty(stringFromMap(runtimeState, "waiting_on"), stringFromMap(runtimeState, "waitingOn")),
	}
}

func extractContentBlocks(raw map[string]any) []ContentBlock {
	message := mapFromAny(raw["message"])
	content := sliceFromAny(message["content"])
	if len(content) == 0 {
		if text := stringFromMap(raw, "result"); text != "" {
			return []ContentBlock{{Type: ContentResult, Text: text}}
		}
		if text := stringFromMap(raw, "description"); text != "" {
			return []ContentBlock{{Type: ContentSystem, Text: text}}
		}
		return []ContentBlock{}
	}

	blocks := make([]ContentBlock, 0, len(content))
	for _, item := range content {
		block := mapFromAny(item)
		switch stringFromMap(block, "type") {
		case "text":
			blocks = append(blocks, ContentBlock{Type: ContentText, Text: stringFromMap(block, "text")})
		case "thinking":
			blocks = append(blocks, ContentBlock{Type: ContentThinking, Text: firstNonEmpty(stringFromMap(block, "thinking"), stringFromMap(block, "text"))})
		case "tool_use":
			blocks = append(blocks, ContentBlock{
				Type:      ContentToolUse,
				ToolUseID: stringFromMap(block, "id"),
				Name:      stringFromMap(block, "name"),
				Input:     mapFromAny(block["input"]),
			})
		case "tool_result":
			blocks = append(blocks, ContentBlock{
				Type:      ContentToolResult,
				ToolUseID: stringFromMap(block, "tool_use_id"),
				Text:      textFromToolResult(block["content"]),
				Output:    block["content"],
				IsError:   boolFromAny(block["is_error"]),
			})
		}
	}
	return blocks
}

func (f *SessionFrame) applyTaskProgress(raw map[string]any) {
	if f.Subtype != "task_progress" && f.Subtype != "task_started" && f.Subtype != "task_notification" {
		return
	}
	usage := extractUsage(mapFromAny(raw["usage"]))
	f.Usage = usage
	if usage != nil && usage.ToolUseCount > 0 {
		f.Runtime = &RuntimeSnapshot{
			Phase:        "tool_running",
			ActiveTool:   stringFromMap(raw, "last_tool_name"),
			ProgressText: stringFromMap(raw, "description"),
		}
	}
	if duration := int64FromAny(mapFromAny(raw["usage"])["duration_ms"]); duration > 0 {
		f.DurationMs = duration
	}
	if status := stringFromMap(raw, "status"); status == "completed" {
		success := true
		f.Success = &success
	}
}

func (f *SessionFrame) applyToolUseResult(raw map[string]any) {
	result := toolUseResultFromRaw(raw)
	if len(result) == 0 {
		return
	}
	f.AgentID = firstNonEmpty(f.AgentID, stringFromMap(result, "agentId"))
	f.DurationMs = int64FromAny(result["totalDurationMs"])
	f.Usage = &Usage{
		TotalTokens:  intFromAny(result["totalTokens"]),
		ToolUseCount: intFromAny(result["totalToolUseCount"]),
	}
	if status := stringFromMap(result, "status"); status != "" {
		switch strings.ToLower(status) {
		case "completed", "success", "done":
			success := true
			f.Success = &success
		case "failed", "error", "stopped", "cancelled", "canceled":
			success := false
			f.Success = &success
		}
	}
}

func (f *SessionFrame) applyResult(raw map[string]any) {
	if stringFromMap(raw, "type") != "result" {
		return
	}
	f.Kind = FrameKindResult
	f.Role = RoleAssistant
	f.Result = stringFromMap(raw, "result")
	f.DurationMs = int64FromAny(raw["duration_ms"])
	subtype := stringFromMap(raw, "subtype")
	f.IsError = boolFromAny(raw["is_error"]) || subtype == "error" || subtype == "failed" || strings.Contains(subtype, "error")
	success := !f.IsError && stringFromMap(raw, "subtype") != "error"
	f.Success = &success
	if f.Result != "" && len(f.Content) == 0 {
		f.Content = []ContentBlock{{Type: ContentResult, Text: f.Result}}
	}
	if errorMessage := firstNonEmpty(stringFromMap(raw, "error"), stringFromMap(raw, "message")); f.IsError && errorMessage != "" {
		f.Error = errorMessage
		if len(f.Content) == 0 {
			f.Content = []ContentBlock{{Type: ContentError, Text: errorMessage}}
		}
	}
}

func (f *SessionFrame) applyTerminalTurn(event provider.OutputEvent) {
	if f.Sidechain {
		return
	}

	if eventIsTerminalTurn(event) {
		f.Kind = FrameKindResult
		if f.Role == "" {
			f.Role = RoleAssistant
		}
		subtype := stringFromMap(event.Message, "subtype")
		isError := boolFromAny(event.Message["is_error"]) || subtype == "error" || subtype == "failed" || strings.Contains(subtype, "error")
		f.IsError = isError
		success := !isError
		f.Success = &success
		phase := "completed"
		if !success {
			phase = "failed"
		}
		f.Runtime = &RuntimeSnapshot{Phase: phase}
	}
}

func extractUsage(raw map[string]any) *Usage {
	if len(raw) == 0 {
		return nil
	}
	return &Usage{
		InputTokens:      intFromAny(raw["input_tokens"]),
		OutputTokens:     intFromAny(raw["output_tokens"]),
		CacheReadTokens:  intFromAny(raw["cache_read_input_tokens"]),
		CacheWriteTokens: intFromAny(raw["cache_creation_input_tokens"]),
		TotalTokens:      intFromAny(raw["total_tokens"]),
		ToolUseCount:     intFromAny(raw["tool_uses"]),
	}
}

func textFromToolResult(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []any:
		text := ""
		for _, item := range v {
			block := mapFromAny(item)
			if stringFromMap(block, "type") == "text" {
				if text != "" {
					text += "\n"
				}
				text += stringFromMap(block, "text")
			}
		}
		return text
	default:
		if value == nil {
			return ""
		}
		return fmt.Sprint(value)
	}
}

func isBackgroundTaskControlFrame(raw map[string]any, content []ContentBlock) bool {
	if stringFromMap(raw, "ropcode_scope") == "background_task" {
		return true
	}
	if stringFromMap(mapFromAny(raw["debug_meta"]), "ropcode_scope") == "background_task" {
		return true
	}
	if isAsyncLaunchToolResult(raw) || taskNotificationID(raw) != "" {
		return true
	}
	for _, block := range content {
		if block.Type == ContentToolUse && boolFromAny(block.Input["run_in_background"]) {
			return true
		}
	}
	return false
}

func isAsyncLaunchToolResult(raw map[string]any) bool {
	result := toolUseResultFromRaw(raw)
	return boolFromAny(result["isAsync"]) && strings.ToLower(stringFromMap(result, "status")) == "async_launched"
}

func toolUseResultFromRaw(raw map[string]any) map[string]any {
	return firstMap(mapFromAny(raw["tool_use_result"]), mapFromAny(raw["toolUseResult"]))
}

func taskNotificationID(raw map[string]any) string {
	if kind := stringFromMap(mapFromAny(raw["origin"]), "kind"); kind != "" && kind != "task-notification" {
		return ""
	}
	text := taskNotificationText(raw)
	if !strings.Contains(text, "<task-notification>") {
		return ""
	}
	return xmlTagText(text, "task-id")
}

func taskNotificationText(raw map[string]any) string {
	message := mapFromAny(raw["message"])
	switch content := message["content"].(type) {
	case string:
		return content
	case []any:
		var parts []string
		for _, item := range content {
			block := mapFromAny(item)
			if text := stringFromMap(block, "text"); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

func xmlTagText(text, tag string) string {
	open := "<" + tag + ">"
	close := "</" + tag + ">"
	start := strings.Index(text, open)
	if start < 0 {
		return ""
	}
	start += len(open)
	end := strings.Index(text[start:], close)
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(text[start : start+end])
}

func stringFromMap(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return nil
}

func firstMap(values ...map[string]any) map[string]any {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func sliceFromAny(value any) []any {
	if value == nil {
		return nil
	}
	if s, ok := value.([]any); ok {
		return s
	}
	if s, ok := value.([]map[string]interface{}); ok {
		result := make([]any, len(s))
		for i, v := range s {
			result[i] = v
		}
		return result
	}
	return nil
}

func boolFromAny(value any) bool {
	v, _ := value.(bool)
	return v
}

func intFromAny(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

func int64FromAny(value any) int64 {
	switch v := value.(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	default:
		return 0
	}
}
