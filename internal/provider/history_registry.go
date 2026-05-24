package provider

import "sync"

var (
	historyNormalizersMu   sync.RWMutex
	historyNormalizers     = map[string]func(map[string]any) OutputEvent{}
	historyDocNormalizers  = map[string]func(map[string]any) []OutputEvent{}
)

func RegisterHistoryNormalizer(id string, fn func(map[string]any) OutputEvent) {
	historyNormalizersMu.Lock()
	historyNormalizers[id] = fn
	historyNormalizersMu.Unlock()
}

func RegisterHistoryDocNormalizer(id string, fn func(map[string]any) []OutputEvent) {
	historyNormalizersMu.Lock()
	historyDocNormalizers[id] = fn
	historyNormalizersMu.Unlock()
}

func NormalizeHistoryEntry(providerID string, raw map[string]any) OutputEvent {
	historyNormalizersMu.RLock()
	fn, ok := historyNormalizers[providerID]
	historyNormalizersMu.RUnlock()
	if ok {
		return fn(raw)
	}
	return OutputEvent{
		Type:    stringFromRaw(raw, "type"),
		Message: raw,
	}
}

func NormalizeHistoryDocument(providerID string, raw map[string]any) []OutputEvent {
	historyNormalizersMu.RLock()
	fn, ok := historyDocNormalizers[providerID]
	historyNormalizersMu.RUnlock()
	if ok {
		return fn(raw)
	}
	return []OutputEvent{NormalizeHistoryEntry(providerID, raw)}
}

func stringFromRaw(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}
