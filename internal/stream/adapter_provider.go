package stream

import (
	"errors"
	"log"
	"strings"
	"sync"

	"ropcode/internal/provider"
)

var ErrMissingProviderRuntimeSession = errors.New("provider output missing runtime session id")
var ErrUserEchoFrameSuppressed = errors.New("provider user echo frame suppressed")

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
}

func NewProviderBridge(hub *Hub) *ProviderBridge {
	return &ProviderBridge{
		hub:                     hub,
		seq:                     make(map[string]int64),
		taskNotificationReplies: make(map[string]string),
	}
}

func (b *ProviderBridge) EmitProviderOutput(ctx ProviderOutputContext, event provider.OutputEvent) error {
	frame, err := b.FrameFromProviderOutput(ctx, event)
	if err != nil {
		if errors.Is(err, ErrUserEchoFrameSuppressed) {
			return nil
		}
		log.Printf("[stream] provider output frame conversion failed provider=%s runtime=%s provider_session=%s event_type=%s subtype=%s err=%v",
			ctx.Provider,
			ctx.RuntimeSessionID,
			ctx.ProviderSessionID,
			event.Type,
			event.Subtype,
			err,
		)
		return err
	}
	return b.hub.Append(frame)
}

func (b *ProviderBridge) FrameFromProviderOutput(ctx ProviderOutputContext, event provider.OutputEvent) (SessionFrame, error) {
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
	b.applyTaskNotificationReplyScope(streamID, event, &frame)
	return frame, nil
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
		log.Printf("[stream] task notification reply scope started stream=%s task=%s event_type=%s subtype=%s frame=%s",
			streamID,
			taskID,
			event.Type,
			event.Subtype,
			frame.FrameID,
		)
	}
	activeTaskID := b.taskNotificationReplies[streamID]
	if activeTaskID != "" && eventIsTerminalTurn(event) {
		delete(b.taskNotificationReplies, streamID)
		log.Printf("[stream] task notification reply scope ended stream=%s task=%s event_type=%s subtype=%s frame=%s",
			streamID,
			activeTaskID,
			event.Type,
			event.Subtype,
			frame.FrameID,
		)
	}
	b.mu.Unlock()

	if activeTaskID == "" || taskID != "" {
		return
	}

	frame.Sidechain = true
	frame.TaskID = firstNonEmpty(frame.TaskID, activeTaskID)
	frame.AgentID = firstNonEmpty(frame.AgentID, activeTaskID)
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
