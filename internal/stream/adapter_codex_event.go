package stream

import "ropcode/internal/provider"

func AdaptCodexOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	providerID := firstNonEmpty(ctx.Provider, event.Provider, "codex")
	runtimeSessionID := firstNonEmpty(ctx.RuntimeSessionID, event.SessionID)
	if runtimeSessionID == "" {
		return SessionFrame{}, ErrMissingProviderRuntimeSession
	}

	raw := copyRaw(event.Message)
	streamID := StreamIDForSession(providerID, runtimeSessionID)
	frame := SessionFrame{
		StreamID:          streamID,
		FrameID:           nextFrameID(streamID, seq),
		Provider:          providerID,
		RuntimeSessionID:  runtimeSessionID,
		ProviderSessionID: firstNonEmpty(ctx.ProviderSessionID, stringFromMap(event.Message, "thread_id")),
		Cwd:               firstNonEmpty(ctx.Cwd, stringFromMap(event.Message, "cwd")),
		ProjectPath:       ctx.ProjectPath,
		Seq:               seq,
		Timestamp:         firstNonEmpty(stringFromMap(event.Message, "timestamp"), nowTimestamp()),
		Kind:              kindFromProviderOutput(event),
		Role:              roleFromProviderOutput(event),
		Subtype:           event.Subtype,
		Content:           codexContentBlocks(event.Message),
		Meta:              Meta{Raw: raw},
	}
	frame.applyCodexCompletion(event)
	return frame, nil
}

func codexContentBlocks(raw map[string]any) []ContentBlock {
	payload := mapFromAny(raw["payload"])
	switch stringFromMap(payload, "type") {
	case "message":
		return codexMessageContent(payload)
	case "reasoning":
		text := codexReasoningText(payload)
		if text == "" {
			return nil
		}
		return []ContentBlock{{Type: ContentThinking, Text: text}}
	case "function_call", "custom_tool_call":
		return []ContentBlock{{
			Type:      ContentToolUse,
			ToolUseID: firstNonEmpty(stringFromMap(payload, "call_id"), stringFromMap(payload, "id")),
			Name:      stringFromMap(payload, "name"),
			Input:     codexToolInput(payload),
		}}
	case "function_call_output", "custom_tool_call_output":
		return []ContentBlock{{
			Type:      ContentToolResult,
			ToolUseID: firstNonEmpty(stringFromMap(payload, "call_id"), stringFromMap(payload, "id")),
			Text:      textFromCodexOutput(payload["output"]),
			Output:    payload["output"],
		}}
	default:
		if text := stringFromMap(raw, "delta"); text != "" {
			return []ContentBlock{{Type: ContentText, Text: text}}
		}
		return nil
	}
}

func codexMessageContent(payload map[string]any) []ContentBlock {
	content := sliceFromAny(payload["content"])
	blocks := make([]ContentBlock, 0, len(content))
	for _, item := range content {
		block := mapFromAny(item)
		switch stringFromMap(block, "type") {
		case "input_text", "output_text", "text":
			blocks = append(blocks, ContentBlock{Type: ContentText, Text: stringFromMap(block, "text")})
		}
	}
	return blocks
}

func codexReasoningText(payload map[string]any) string {
	if text := stringFromMap(payload, "text"); text != "" {
		return text
	}
	for _, item := range sliceFromAny(payload["summary"]) {
		block := mapFromAny(item)
		if text := stringFromMap(block, "text"); text != "" {
			return text
		}
	}
	return ""
}

func codexToolInput(payload map[string]any) map[string]any {
	if args := mapFromAny(payload["arguments"]); len(args) > 0 {
		return args
	}
	if input := mapFromAny(payload["input"]); len(input) > 0 {
		return input
	}
	return nil
}

func textFromCodexOutput(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return textFromClaudeToolResult(value)
}

func (f *SessionFrame) applyCodexCompletion(event provider.OutputEvent) {
	switch event.Subtype {
	case "session_complete", "turn_completed":
		f.Kind = FrameKindResult
		success := true
		f.Success = &success
	case "":
		if event.Type == "error" {
			f.Kind = FrameKindError
			f.IsError = true
			success := false
			f.Success = &success
		}
	}
}
