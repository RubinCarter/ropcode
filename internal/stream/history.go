package stream

import "ropcode/internal/provider"

func AdaptClaudeHistoryEntry(ctx ProviderOutputContext, raw map[string]any, seq int64) (SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "claude")
	event := provider.OutputEvent{
		Type:              firstNonEmpty(stringFromMap(raw, "type"), "assistant"),
		Subtype:           stringFromMap(raw, "subtype"),
		SessionID:         firstNonEmpty(ctx.RuntimeSessionID, stringFromMap(raw, "runtime_session_id")),
		Provider:          "claude",
		ProjectPath:       ctx.ProjectPath,
		Cwd:               firstNonEmpty(ctx.Cwd, stringFromMap(raw, "cwd")),
		ProviderSessionID: firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "sessionId"), stringFromMap(raw, "session_id")),
		Message:           raw,
	}
	return AdaptClaudeOutput(ctx, event, seq)
}

func AdaptCodexHistoryEvent(ctx ProviderOutputContext, raw map[string]any, seq int64) (SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "codex")
	event := provider.OutputEvent{
		Type:              codexHistoryEventType(raw),
		Subtype:           codexHistorySubtype(raw),
		SessionID:         firstNonEmpty(ctx.RuntimeSessionID, stringFromMap(raw, "session_id")),
		Provider:          "codex",
		ProjectPath:       ctx.ProjectPath,
		Cwd:               firstNonEmpty(ctx.Cwd, stringFromMap(raw, "cwd")),
		ProviderSessionID: firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "thread_id")),
		Message:           raw,
	}
	return AdaptCodexOutput(ctx, event, seq)
}

func AdaptDeepSeekHistoryDocument(ctx ProviderOutputContext, raw map[string]any, startSeq int64) ([]SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "deepseek")
	ctx.ProviderSessionID = firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "id"), stringFromMap(raw, "session_id"), stringFromMap(raw, "sessionId"))
	ctx.Cwd = firstNonEmpty(ctx.Cwd, stringFromMap(raw, "workspace"), stringFromMap(raw, "cwd"), stringFromMap(raw, "project_path"), stringFromMap(raw, "projectPath"))

	var frames []SessionFrame
	seq := startSeq
	for _, item := range deepseekHistoryItems(raw) {
		itemMap := mapFromAny(item)
		if len(itemMap) == 0 {
			continue
		}
		event := deepseekHistoryEvent(ctx, itemMap)
		frame, err := AdaptDeepSeekOutput(ctx, event, seq)
		if err != nil {
			return nil, err
		}
		if len(frame.Content) == 0 {
			if text := deepseekHistoryText(itemMap); text != "" {
				frame.Content = []ContentBlock{{Type: ContentText, Text: text}}
			}
		}
		if len(frame.Content) == 0 && frame.Kind != FrameKindMetadata && frame.Kind != FrameKindResult {
			continue
		}
		frames = append(frames, frame)
		seq++
	}
	return frames, nil
}

func codexHistoryEventType(raw map[string]any) string {
	switch stringFromMap(raw, "type") {
	case "thread.started", "session_meta":
		return "system"
	case "turn.completed", "thread.completed", "thread.cancelled":
		return "system"
	case "thread.error", "error", "turn.failed":
		return "error"
	case "message.delta":
		return "assistant"
	case "response_item":
		payloadType := stringFromMap(mapFromAny(raw["payload"]), "type")
		switch payloadType {
		case "function_call", "custom_tool_call":
			return "tool_use"
		case "function_call_output", "custom_tool_call_output":
			return "tool_result"
		default:
			return "assistant"
		}
	default:
		return "assistant"
	}
}

func codexHistorySubtype(raw map[string]any) string {
	switch stringFromMap(raw, "type") {
	case "thread.started", "session_meta":
		return "init"
	case "turn.completed":
		return "turn_completed"
	case "thread.completed", "thread.cancelled":
		return "session_complete"
	}
	if stringFromMap(raw, "type") == "response_item" {
		return stringFromMap(mapFromAny(raw["payload"]), "type")
	}
	return stringFromMap(raw, "subtype")
}

func deepseekHistoryItems(raw map[string]any) []any {
	for _, key := range []string{"messages", "turns", "items"} {
		if values := sliceFromAny(raw[key]); len(values) > 0 {
			return values
		}
	}
	return nil
}

func deepseekHistoryEvent(ctx ProviderOutputContext, item map[string]any) provider.OutputEvent {
	eventType := stringFromMap(item, "type")
	if eventType == "" {
		if role := stringFromMap(item, "role"); role == "user" || role == "user_message" {
			eventType = "user"
		} else {
			eventType = "content"
		}
	}

	outputType := "assistant"
	subtype := ""
	switch eventType {
	case "tool_use":
		outputType = "tool_use"
	case "tool_result":
		outputType = "tool_result"
	case "session_capture":
		outputType = "system"
		subtype = "session_capture"
	case "metadata":
		outputType = "system"
		subtype = "metadata"
	case "done":
		outputType = "system"
		subtype = "session_complete"
	case "error":
		outputType = "error"
	case "user", "user_message":
		outputType = "user"
		item["type"] = "content"
		if item["content"] == nil {
			item["content"] = deepseekHistoryText(item)
		}
	default:
		item["type"] = eventType
	}

	return provider.OutputEvent{
		Type:              outputType,
		Subtype:           subtype,
		SessionID:         ctx.RuntimeSessionID,
		Provider:          "deepseek",
		ProjectPath:       ctx.ProjectPath,
		Cwd:               ctx.Cwd,
		ProviderSessionID: ctx.ProviderSessionID,
		Message:           item,
	}
}

func deepseekHistoryText(item map[string]any) string {
	for _, key := range []string{"content", "text", "detail", "summary", "prompt"} {
		if text := stringFromMap(item, key); text != "" {
			return text
		}
	}
	for _, block := range sliceFromAny(item["content"]) {
		if text := stringFromMap(mapFromAny(block), "text"); text != "" {
			return text
		}
	}
	return ""
}
