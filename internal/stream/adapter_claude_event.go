package stream

import (
	"fmt"

	"ropcode/internal/provider"
)

func AdaptClaudeOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	providerID := firstNonEmpty(ctx.Provider, event.Provider, "claude")
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
		FrameID:           nextFrameID(streamID, seq),
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
		Content:           claudeContentBlocks(event.Message),
		ParentToolUseID:   stringFromMap(event.Message, "parent_tool_use_id"),
		TaskID:            stringFromMap(event.Message, "task_id"),
		ToolUseID:         stringFromMap(event.Message, "tool_use_id"),
		Meta:              Meta{Raw: raw},
	}

	frame.Sidechain = frame.ParentToolUseID != "" || frame.TaskID != ""
	if frame.TaskID != "" {
		frame.AgentID = frame.TaskID
	}
	frame.applyClaudeRuntimeState(event.Message)
	frame.applyClaudeTaskProgress(event.Message)
	frame.applyClaudeToolUseResult(event.Message)
	frame.applyClaudeResult(event.Message)
	if frame.Usage == nil {
		frame.Usage = claudeUsage(firstMap(mapFromAny(event.Message["usage"]), mapFromAny(mapFromAny(event.Message["message"])["usage"])))
	}
	return frame, nil
}

func (f *SessionFrame) applyClaudeRuntimeState(raw map[string]any) {
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

func claudeContentBlocks(raw map[string]any) []ContentBlock {
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
				Text:      textFromClaudeToolResult(block["content"]),
				Output:    block["content"],
				IsError:   boolFromAny(block["is_error"]),
			})
		}
	}
	return blocks
}

func (f *SessionFrame) applyClaudeTaskProgress(raw map[string]any) {
	if f.Subtype != "task_progress" && f.Subtype != "task_started" && f.Subtype != "task_notification" {
		return
	}
	usage := claudeUsage(mapFromAny(raw["usage"]))
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

func (f *SessionFrame) applyClaudeToolUseResult(raw map[string]any) {
	result := mapFromAny(raw["tool_use_result"])
	if len(result) == 0 {
		return
	}
	f.AgentID = stringFromMap(result, "agentId")
	f.DurationMs = int64FromAny(result["totalDurationMs"])
	f.Usage = &Usage{
		TotalTokens:  intFromAny(result["totalTokens"]),
		ToolUseCount: intFromAny(result["totalToolUseCount"]),
	}
	if status := stringFromMap(result, "status"); status != "" {
		success := status == "completed"
		f.Success = &success
	}
}

func (f *SessionFrame) applyClaudeResult(raw map[string]any) {
	if stringFromMap(raw, "type") != "result" {
		return
	}
	f.Kind = FrameKindResult
	f.Role = RoleAssistant
	f.Result = stringFromMap(raw, "result")
	f.DurationMs = int64FromAny(raw["duration_ms"])
	f.IsError = boolFromAny(raw["is_error"])
	success := !f.IsError && stringFromMap(raw, "subtype") != "error"
	f.Success = &success
	if f.Result != "" && len(f.Content) == 0 {
		f.Content = []ContentBlock{{Type: ContentResult, Text: f.Result}}
	}
}

func claudeUsage(raw map[string]any) *Usage {
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

func textFromClaudeToolResult(value any) string {
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
