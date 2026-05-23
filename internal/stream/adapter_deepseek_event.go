package stream

import "ropcode/internal/provider"

func AdaptDeepSeekOutput(ctx ProviderOutputContext, event provider.OutputEvent, seq int64) (SessionFrame, error) {
	providerID := firstNonEmpty(ctx.Provider, event.Provider, "deepseek")
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
		ProviderSessionID: firstNonEmpty(ctx.ProviderSessionID, deepseekProviderSessionID(event.Message)),
		Cwd:               firstNonEmpty(ctx.Cwd, stringFromMap(event.Message, "cwd")),
		ProjectPath:       ctx.ProjectPath,
		Seq:               seq,
		Timestamp:         firstNonEmpty(stringFromMap(event.Message, "timestamp"), nowTimestamp()),
		Kind:              deepseekKind(event),
		Role:              roleFromProviderOutput(event),
		Subtype:           event.Subtype,
		Content:           deepseekContentBlocks(event.Message),
		Meta:              Meta{Raw: raw},
		Usage:             claudeUsage(firstMap(mapFromAny(event.Message["usage"]), mapFromAny(event.Message["meta"]))),
	}
	frame.applyDeepSeekResult(event)
	return frame, nil
}

func deepseekKind(event provider.OutputEvent) FrameKind {
	if stringFromMap(event.Message, "type") == "content" {
		return FrameKindDelta
	}
	if event.Subtype == "session_capture" {
		return FrameKindInit
	}
	return kindFromProviderOutput(event)
}

func deepseekContentBlocks(raw map[string]any) []ContentBlock {
	switch stringFromMap(raw, "type") {
	case "content":
		if text := stringFromMap(raw, "content"); text != "" {
			return []ContentBlock{{Type: ContentText, Text: text}}
		}
		return nil
	case "tool_use":
		name, input := deepseekTool(stringFromMap(raw, "name"), mapFromAny(raw["input"]))
		return []ContentBlock{{
			Type:      ContentToolUse,
			ToolUseID: stringFromMap(raw, "id"),
			Name:      name,
			Input:     input,
		}}
	case "tool_result":
		return []ContentBlock{{
			Type:      ContentToolResult,
			ToolUseID: stringFromMap(raw, "id"),
			Text:      stringFromMap(raw, "output"),
			Output:    raw["output"],
			IsError:   stringFromMap(raw, "status") == "error",
		}}
	default:
		return nil
	}
}

func deepseekTool(name string, input map[string]any) (string, map[string]any) {
	switch name {
	case "exec_shell":
		return "Bash", map[string]any{"command": firstNonEmpty(stringFromMap(input, "command"), stringFromMap(input, "cmd"))}
	case "read_file":
		return "Read", map[string]any{"file_path": stringFromMap(input, "path")}
	case "write_file":
		return "Write", map[string]any{"file_path": stringFromMap(input, "path"), "content": stringFromMap(input, "content")}
	default:
		return name, input
	}
}

func deepseekProviderSessionID(raw map[string]any) string {
	if stringFromMap(raw, "type") == "session_capture" {
		return stringFromMap(raw, "content")
	}
	return stringFromMap(mapFromAny(raw["meta"]), "session_id")
}

func (f *SessionFrame) applyDeepSeekResult(event provider.OutputEvent) {
	switch event.Subtype {
	case "metadata":
		f.Kind = FrameKindMetadata
	case "session_complete":
		f.Kind = FrameKindResult
		success := true
		f.Success = &success
	}
	if event.Type == "error" {
		f.Kind = FrameKindError
		f.Error = stringFromMap(event.Message, "error")
		f.IsError = true
		success := false
		f.Success = &success
	}
}
