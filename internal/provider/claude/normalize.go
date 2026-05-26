package claude

import "ropcode/internal/provider"

func init() {
	provider.RegisterHistoryNormalizer("claude", NormalizeHistoryEntry)
}

func NormalizeHistoryEntry(raw map[string]any) provider.OutputEvent {
	eventType, _ := raw["type"].(string)
	if eventType == "" {
		eventType = "assistant"
	}
	subtype, _ := raw["subtype"].(string)
	return provider.OutputEvent{
		Type:    eventType,
		Subtype: subtype,
		Message: raw,
	}
}
