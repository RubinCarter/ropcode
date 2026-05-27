package pi

import "ropcode/internal/provider"

func init() {
	provider.RegisterHistoryNormalizer("pi", NormalizeHistoryEntry)
}

func NormalizeHistoryEntry(raw map[string]interface{}) provider.OutputEvent {
	data, err := commandJSON(raw)
	if err != nil {
		return provider.OutputEvent{Type: "raw", Message: raw}
	}
	event := (&Driver{}).ParseOutput(data)
	if event == nil {
		return provider.OutputEvent{Type: "raw", Message: raw}
	}
	return *event
}
