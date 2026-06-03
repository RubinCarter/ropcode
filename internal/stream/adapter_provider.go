package stream

import (
	"errors"
	"strings"
	"sync"

	"ropcode/internal/provider"
)

var ErrMissingProviderRuntimeSession = errors.New("provider output missing runtime session id")
var ErrUserEchoFrameSuppressed = errors.New("provider user echo frame suppressed")
var ErrProviderStreamFrameSuppressed = errors.New("provider stream frame suppressed")
var ErrProviderOutputSuppressed = errors.New("provider output suppressed")

type ProviderOutputContext struct {
	RuntimeSessionID  string
	ProviderSessionID string
	Provider          string
	Cwd               string
	ProjectPath       string
}

type ProviderBridge struct {
	hub                     *Hub
	mu                      sync.Mutex
	seq                     map[string]int64
	taskNotificationReplies map[string]string
	streamingMessages       map[string]SessionFrame
}

func NewProviderBridge(hub *Hub) *ProviderBridge {
	return &ProviderBridge{
		hub:                     hub,
		seq:                     make(map[string]int64),
		taskNotificationReplies: make(map[string]string),
		streamingMessages:       make(map[string]SessionFrame),
	}
}

func (b *ProviderBridge) EmitProviderOutput(ctx ProviderOutputContext, event provider.OutputEvent) error {
	frame, err := b.FrameFromProviderOutput(ctx, event)
	if err != nil {
		if errors.Is(err, ErrUserEchoFrameSuppressed) || errors.Is(err, ErrProviderStreamFrameSuppressed) || errors.Is(err, ErrProviderOutputSuppressed) {
			return nil
		}
		return err
	}
	return b.hub.Append(frame)
}

func (b *ProviderBridge) FrameFromProviderOutput(ctx ProviderOutputContext, event provider.OutputEvent) (SessionFrame, error) {
	if event.Suppressed() {
		return SessionFrame{}, ErrProviderOutputSuppressed
	}

	providerID := firstNonEmpty(ctx.Provider, event.Provider)
	runtimeSessionID := firstNonEmpty(ctx.RuntimeSessionID, event.SessionID)
	if runtimeSessionID == "" {
		return SessionFrame{}, ErrMissingProviderRuntimeSession
	}

	streamID := StreamIDForSession(providerID, runtimeSessionID)
	seq := b.nextSeq(streamID)
	frame, err := AdaptUnifiedOutput(ctx, event, seq)
	if err != nil {
		return SessionFrame{}, err
	}
	if isSuppressibleUserEchoFrame(frame) {
		return SessionFrame{}, ErrUserEchoFrameSuppressed
	}
	if frameHasNoDisplayablePayload(frame) {
		return SessionFrame{}, ErrProviderOutputSuppressed
	}
	b.applyTaskNotificationReplyScope(streamID, event, &frame)
	frame, err = b.applyStreamingAggregation(frame)
	if err != nil {
		return SessionFrame{}, err
	}
	frame.refreshStableFrameID()
	return frame, nil
}

func frameHasNoDisplayablePayload(frame SessionFrame) bool {
	if len(frame.Content) > 0 || frame.Kind == FrameKindResult || frame.Usage != nil || frame.Runtime != nil {
		return false
	}
	if isBackgroundTaskControlFrame(frame.Meta.Raw, frame.Content) {
		return false
	}
	return frame.Kind == FrameKindMessage || frame.Kind == FrameKindMetadata
}

func (b *ProviderBridge) nextSeq(streamID string) int64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.seq[streamID]++
	return b.seq[streamID]
}

func (b *ProviderBridge) applyTaskNotificationReplyScope(streamID string, event provider.OutputEvent, frame *SessionFrame) {
	taskID := taskNotificationID(event.Message)

	b.mu.Lock()
	if taskID != "" {
		b.taskNotificationReplies[streamID] = taskID
	}
	activeTaskID := b.taskNotificationReplies[streamID]
	if activeTaskID != "" && eventIsTerminalTurn(event) {
		delete(b.taskNotificationReplies, streamID)
	}
	b.mu.Unlock()

	if activeTaskID == "" || taskID != "" {
		return
	}

	frame.Sidechain = true
	frame.TaskID = firstNonEmpty(frame.TaskID, activeTaskID)
	frame.AgentID = firstNonEmpty(frame.AgentID, activeTaskID)
}

func (b *ProviderBridge) applyStreamingAggregation(frame SessionFrame) (SessionFrame, error) {
	if frame.Kind == FrameKindResult || frame.Kind == FrameKindError {
		b.clearStreamingMessagesForFrameScope(frame)
		return frame, nil
	}
	if frame.MessageID == "" || frame.Role != RoleAssistant || !textOnlyFrameContent(frame.Content) {
		return frame, nil
	}

	switch frame.Kind {
	case FrameKindDelta:
		return b.upsertStreamingDeltaFrame(frame), nil
	case FrameKindMessage:
		return b.reconcileStreamingCompletedFrame(frame)
	default:
		return frame, nil
	}
}

func (b *ProviderBridge) upsertStreamingDeltaFrame(frame SessionFrame) SessionFrame {
	frame.Kind = FrameKindMessage
	frame.Operation = FrameOperationUpsert
	key := streamingMessageKey(frame)

	b.mu.Lock()
	defer b.mu.Unlock()

	if existing, ok := b.streamingMessages[key]; ok {
		frame.Content = mergeFrameContent(existing.Content, frame.Content)
		frame.ProviderSessionID = firstNonEmpty(frame.ProviderSessionID, existing.ProviderSessionID)
		if frame.Runtime == nil {
			frame.Runtime = existing.Runtime
		}
		if frame.Usage == nil {
			frame.Usage = existing.Usage
		}
	}
	syncRawMessageContent(&frame)
	b.streamingMessages[key] = frame
	frame.refreshStableFrameID()
	return frame
}

func (b *ProviderBridge) reconcileStreamingCompletedFrame(frame SessionFrame) (SessionFrame, error) {
	key := streamingMessageKey(frame)

	b.mu.Lock()
	existing, ok := b.streamingMessages[key]
	if ok {
		delete(b.streamingMessages, key)
	}
	b.mu.Unlock()

	if !ok {
		return markAssistantTextMessageUpsert(frame), nil
	}

	previousText := frameContentText(existing.Content)
	incomingText := frameContentText(frame.Content)
	if previousText == "" || incomingText == "" {
		return frame, nil
	}
	if incomingText == previousText || strings.HasPrefix(previousText, incomingText) {
		return SessionFrame{}, ErrProviderStreamFrameSuppressed
	}

	frame.Kind = FrameKindMessage
	frame = markAssistantTextMessageUpsert(frame)
	syncRawMessageContent(&frame)
	frame.refreshStableFrameID()
	return frame, nil
}

func markAssistantTextMessageUpsert(frame SessionFrame) SessionFrame {
	if frame.MessageID != "" && frame.Role == RoleAssistant && textOnlyFrameContent(frame.Content) {
		frame.Kind = FrameKindMessage
		frame.Operation = FrameOperationUpsert
	}
	return frame
}

func (b *ProviderBridge) clearStreamingMessagesForFrameScope(frame SessionFrame) {
	prefix := streamingMessageScopePrefix(frame)

	b.mu.Lock()
	defer b.mu.Unlock()

	for key := range b.streamingMessages {
		if strings.HasPrefix(key, prefix) {
			delete(b.streamingMessages, key)
		}
	}
}

func streamingMessageKey(frame SessionFrame) string {
	return streamingMessageScopePrefix(frame) + frame.MessageID
}

func streamingMessageScopePrefix(frame SessionFrame) string {
	sidechain := "root"
	if frame.Sidechain {
		sidechain = "sidechain"
	}
	return strings.Join([]string{
		frame.StreamID,
		sidechain,
		frame.ParentToolUseID,
		frame.TaskID,
		frame.AgentID,
	}, "\x00") + "\x00"
}

func textOnlyFrameContent(content []ContentBlock) bool {
	if len(content) == 0 {
		return false
	}
	for _, block := range content {
		if block.Type != ContentText {
			return false
		}
	}
	return true
}

func frameContentText(content []ContentBlock) string {
	var builder strings.Builder
	for _, block := range content {
		if block.Type == ContentText {
			builder.WriteString(block.Text)
		}
	}
	return builder.String()
}

func mergeFrameContent(left []ContentBlock, right []ContentBlock) []ContentBlock {
	if len(left) == 0 {
		return append([]ContentBlock(nil), right...)
	}
	if len(right) == 0 {
		return append([]ContentBlock(nil), left...)
	}

	merged := append([]ContentBlock(nil), left...)
	first := right[0]
	last := merged[len(merged)-1]
	if last.Type == ContentText && first.Type == ContentText {
		last.Text += first.Text
		merged[len(merged)-1] = last
		merged = append(merged, right[1:]...)
		return merged
	}
	merged = append(merged, right...)
	return merged
}

func syncRawMessageContent(frame *SessionFrame) {
	if frame == nil || len(frame.Content) == 0 || frame.Meta.Raw == nil {
		return
	}

	message := mapFromAny(frame.Meta.Raw["message"])
	if message == nil {
		message = map[string]any{}
		frame.Meta.Raw["message"] = message
	}
	if frame.MessageID != "" && stringFromMap(message, "id") == "" {
		message["id"] = frame.MessageID
	}
	message["content"] = rawContentFromBlocks(frame.Content)
}

func rawContentFromBlocks(content []ContentBlock) []map[string]any {
	blocks := make([]map[string]any, 0, len(content))
	for _, block := range content {
		switch block.Type {
		case ContentText:
			blocks = append(blocks, map[string]any{"type": "text", "text": block.Text})
		case ContentThinking:
			blocks = append(blocks, map[string]any{"type": "thinking", "thinking": block.Text})
		}
	}
	return blocks
}

func isSuppressibleUserEchoFrame(frame SessionFrame) bool {
	if frame.Role != RoleUser || frame.Sidechain {
		return false
	}
	if taskNotificationID(frame.Meta.Raw) != "" {
		return false
	}
	if len(frame.Content) != 1 {
		return false
	}
	if frame.Content[0].Type != ContentText {
		return false
	}
	text := stripProviderInjectedUserPrefixes(frame.Content[0].Text)
	return strings.TrimSpace(text) != "" || strings.TrimSpace(frame.Content[0].Text) != ""
}

func stripProviderInjectedUserPrefixes(text string) string {
	trimmed := strings.TrimSpace(text)
	for {
		next := stripDelimitedText(trimmed, "<previous_conversation>", "</previous_conversation>")
		next = stripDelimitedText(next, "<system_instruction>", "</system_instruction>")
		next = stripDelimitedText(next, "<system-instruction>", "</system-instruction>")
		next = stripDelimitedText(next, "<environment_context>", "</environment_context>")
		next = strings.TrimSpace(next)
		if next == trimmed {
			return next
		}
		trimmed = next
	}
}

func stripDelimitedText(text, openTag, closeTag string) string {
	out := text
	for {
		start := strings.Index(out, openTag)
		if start < 0 {
			return out
		}
		afterOpen := start + len(openTag)
		relativeEnd := strings.Index(out[afterOpen:], closeTag)
		if relativeEnd < 0 {
			return out
		}
		end := afterOpen + relativeEnd + len(closeTag)
		out = out[:start] + out[end:]
	}
}

func kindFromProviderOutput(event provider.OutputEvent) FrameKind {
	if event.IsDelta {
		return FrameKindDelta
	}
	if eventIsTerminalTurn(event) {
		return FrameKindResult
	}
	switch event.Type {
	case "system":
		if event.Subtype == "init" {
			return FrameKindInit
		}
		return FrameKindMetadata
	case "tool_use", "tool_result":
		return FrameKindTool
	case "error":
		return FrameKindError
	default:
		return FrameKindMessage
	}
}

func eventIsTerminalTurn(event provider.OutputEvent) bool {
	if stringFromMap(event.Message, "type") == "result" || event.Type == "result" || event.Subtype == "result" {
		return true
	}
	message := mapFromAny(event.Message["message"])
	return event.Type == "assistant" && stringFromMap(message, "stop_reason") == "end_turn"
}

func roleFromProviderOutput(event provider.OutputEvent) Role {
	switch event.Type {
	case "user":
		return RoleUser
	case "system":
		return RoleSystem
	case "tool_result":
		return RoleTool
	default:
		return RoleAssistant
	}
}

func copyRaw(raw map[string]any) map[string]any {
	out := make(map[string]any, len(raw))
	for key, value := range raw {
		out[key] = value
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
