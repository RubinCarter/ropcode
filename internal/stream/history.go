package stream

import "ropcode/internal/provider"

func AdaptClaudeHistoryEntry(ctx ProviderOutputContext, raw map[string]any, seq int64) (SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "claude")
	event := provider.NormalizeHistoryEntry("claude", raw)
	event.SessionID = firstNonEmpty(ctx.RuntimeSessionID, stringFromMap(raw, "runtime_session_id"))
	event.Provider = "claude"
	event.ProjectPath = ctx.ProjectPath
	event.Cwd = firstNonEmpty(ctx.Cwd, stringFromMap(raw, "cwd"))
	event.ProviderSessionID = firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "sessionId"), stringFromMap(raw, "session_id"))
	return AdaptUnifiedOutput(ctx, event, seq)
}

func AdaptCodexHistoryEvent(ctx ProviderOutputContext, raw map[string]any, seq int64) (SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "codex")
	event := provider.NormalizeHistoryEntry("codex", raw)
	event.SessionID = firstNonEmpty(ctx.RuntimeSessionID, stringFromMap(raw, "session_id"))
	event.Provider = "codex"
	event.ProjectPath = ctx.ProjectPath
	event.Cwd = firstNonEmpty(ctx.Cwd, stringFromMap(raw, "cwd"))
	event.ProviderSessionID = firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "thread_id"))
	return AdaptUnifiedOutput(ctx, event, seq)
}

func AdaptDeepSeekHistoryDocument(ctx ProviderOutputContext, raw map[string]any, startSeq int64) ([]SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, "deepseek")
	ctx.ProviderSessionID = firstNonEmpty(ctx.ProviderSessionID, stringFromMap(raw, "id"), stringFromMap(raw, "session_id"), stringFromMap(raw, "sessionId"))
	ctx.Cwd = firstNonEmpty(ctx.Cwd, stringFromMap(raw, "workspace"), stringFromMap(raw, "cwd"), stringFromMap(raw, "project_path"), stringFromMap(raw, "projectPath"))

	events := provider.NormalizeHistoryDocument("deepseek", raw)
	return FramesFromEvents("deepseek", ctx, events)
}

// FramesFromEvents converts normalized OutputEvents to SessionFrames.
func FramesFromEvents(providerID string, ctx ProviderOutputContext, events []provider.OutputEvent) ([]SessionFrame, error) {
	ctx.Provider = firstNonEmpty(ctx.Provider, providerID)
	var frames []SessionFrame
	for i, event := range events {
		event.Provider = providerID
		event.SessionID = firstNonEmpty(event.SessionID, ctx.RuntimeSessionID)
		event.ProjectPath = firstNonEmpty(event.ProjectPath, ctx.ProjectPath)
		event.Cwd = firstNonEmpty(event.Cwd, ctx.Cwd)
		event.ProviderSessionID = firstNonEmpty(event.ProviderSessionID, ctx.ProviderSessionID)
		frame, err := AdaptUnifiedOutput(ctx, event, int64(i+1))
		if err != nil {
			return nil, err
		}
		if len(frame.Content) == 0 && frame.Kind != FrameKindMetadata && frame.Kind != FrameKindResult {
			continue
		}
		frames = append(frames, frame)
	}
	return frames, nil
}
