package provider

// EventEmitter 统一的事件发射接口。
type EventEmitter interface {
	Emit(eventName string, data interface{})
}

// ProcessChangedEmitter 进程状态变更发射接口。
type ProcessChangedEmitter interface {
	EmitProcessChanged(event ProcessChangedEvent)
}

// ProcessChangedEvent 统一的进程状态变更事件。
type ProcessChangedEvent struct {
	PID        int    `json:"pid"`
	Cwd        string `json:"cwd"`
	State      string `json:"state"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	ProviderID string `json:"provider_id"`
	SessionID  string `json:"session_id"`
}

// SessionChangedEvent 会话状态变更事件。
type SessionChangedEvent struct {
	SessionID  string `json:"session_id"`
	ProviderID string `json:"provider_id"`
	State      string `json:"state"`
	Health     string `json:"health,omitempty"`
}
