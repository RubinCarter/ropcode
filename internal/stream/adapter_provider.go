package stream

import (
	"errors"
	"sync"

	"ropcode/internal/provider"
)

var ErrMissingProviderRuntimeSession = errors.New("provider output missing runtime session id")

type ProviderOutputContext struct {
	RuntimeSessionID  string
	ProviderSessionID string
	Provider          string
	Cwd               string
	ProjectPath       string
}

type ProviderBridge struct {
	hub *Hub
	mu  sync.Mutex
	seq map[string]int64
}

func NewProviderBridge(hub *Hub) *ProviderBridge {
	return &ProviderBridge{hub: hub, seq: make(map[string]int64)}
}

func (b *ProviderBridge) EmitProviderOutput(ctx ProviderOutputContext, event provider.OutputEvent) error {
	frame, err := b.FrameFromProviderOutput(ctx, event)
	if err != nil {
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
	return AdaptUnifiedOutput(ctx, event, seq)
}

func (b *ProviderBridge) nextSeq(streamID string) int64 {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.seq[streamID]++
	return b.seq[streamID]
}

func kindFromProviderOutput(event provider.OutputEvent) FrameKind {
	if event.IsDelta {
		return FrameKindDelta
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
