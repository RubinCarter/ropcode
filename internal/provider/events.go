package provider

// EventEmitter is the unified event emission interface.
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

const ProviderActivityChangedEvent = "provider:activity_changed"

// ProcessChangedEmitter is the interface for emitting process state changes.
type ProcessChangedEmitter interface {
	EmitProcessChanged(event ProcessChangedEvent)
}

// ProcessChangedEvent is the unified process state change event.
type ProcessChangedEvent struct {
	PID        int    `json:"pid"`
	Cwd        string `json:"cwd"`
	State      string `json:"state"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	ProviderID string `json:"provider_id"`
	SessionID  string `json:"session_id"`
}

// SessionChangedEvent represents a session state change event.
type SessionChangedEvent struct {
	SessionID  string `json:"session_id"`
	ProviderID string `json:"provider_id"`
	State      string `json:"state"`
	Health     string `json:"health,omitempty"`
}
