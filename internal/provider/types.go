package provider

import "time"

// SessionConfig is the unified session configuration.
type SessionConfig struct {
	ProjectPath     string            `json:"project_path"`
	Prompt          string            `json:"prompt"`
	Model           string            `json:"model"`
	SessionID       string            `json:"session_id,omitempty"`
	Resume          bool              `json:"resume,omitempty"`
	Interactive     bool              `json:"interactive,omitempty"`
	ProviderApiID   string            `json:"provider_api_id,omitempty"`
	AuthToken       string            `json:"auth_token,omitempty"`
	BaseURL         string            `json:"base_url,omitempty"`
	ResumeSessionID string            `json:"resume_session_id,omitempty"`
	Extra           map[string]string `json:"extra,omitempty"`
}

// SessionStatus is a session state snapshot for querying and display.
type SessionStatus struct {
	SessionID         string            `json:"session_id"`
	ProviderID        string            `json:"provider_id"`
	ProviderSessionID string            `json:"provider_session_id,omitempty"`
	ProviderApiID     string            `json:"provider_api_id,omitempty"`
	ProjectPath       string            `json:"project_path"`
	Model             string            `json:"model"`
	Status            string            `json:"status"`
	Health            string            `json:"health"`
	StartedAt         time.Time         `json:"started_at"`
	PID               int               `json:"pid"`
	Extra             map[string]string `json:"extra,omitempty"`
}

// OutputEvent is the unified output event produced by driver.ParseOutput.
type OutputEvent struct {
	Type      string                 `json:"type"`
	Subtype   string                 `json:"subtype,omitempty"`
	SessionID string                 `json:"session_id"`
	Provider  string                 `json:"provider"`
	Message   map[string]interface{} `json:"message,omitempty"`
	IsDelta   bool                   `json:"is_delta,omitempty"`
	Raw       string                 `json:"raw,omitempty"`
}

// StderrEvent represents a stderr output event.
type StderrEvent struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// ProcessHealth represents the health state of a process.
type ProcessHealth string

const (
	HealthOK      ProcessHealth = "ok"
	HealthSlow    ProcessHealth = "slow"
	HealthStuck   ProcessHealth = "stuck"
	HealthHanging ProcessHealth = "hanging"
	HealthCrashed ProcessHealth = "crashed"
)

// Message is the shared history message format used by all providers.
// Each provider's history reader converts its native format into this type.
type Message struct {
	ParentUUID  *string                `json:"parentUuid"`
	IsSidechain bool                   `json:"isSidechain"`
	UserType    string                 `json:"userType,omitempty"`
	Cwd         string                 `json:"cwd,omitempty"`
	SessionID   string                 `json:"sessionId,omitempty"`
	Version     string                 `json:"version,omitempty"`
	GitBranch   string                 `json:"gitBranch,omitempty"`
	AgentID     string                 `json:"agentId,omitempty"`
	Message     map[string]interface{} `json:"message,omitempty"`
	Type        string                 `json:"type"`
	UUID        string                 `json:"uuid"`
	Timestamp   string                 `json:"timestamp"`
}

// MessageIndex is the line number index of messages in a JSONL file.
type MessageIndex struct {
	LineNumbers []int `json:"line_numbers"`
	TotalLines  int   `json:"total_lines"`
}

// HistorySessionInfo is session history metadata read from the local filesystem.
type HistorySessionInfo struct {
	ID               string `json:"id"`
	ProjectID        string `json:"project_id"`
	ProjectPath      string `json:"project_path"`
	CreatedAt        int64  `json:"created_at"`
	MessageTimestamp string `json:"message_timestamp,omitempty"`
	FirstMessage     string `json:"first_message,omitempty"`
}

// HistorySessionsResult is the result of a session list query.
type HistorySessionsResult struct {
	Sessions []HistorySessionInfo
	HasMore  bool
}
