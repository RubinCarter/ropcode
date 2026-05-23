package provider

import "time"

// SessionConfig 统一的会话配置。
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

// SessionStatus 会话状态快照，用于查询和展示。
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

// OutputEvent 统一的输出事件，由 driver.ParseOutput 产生。
type OutputEvent struct {
	Type      string                 `json:"type"`
	Subtype   string                 `json:"subtype,omitempty"`
	SessionID string                 `json:"session_id"`
	Provider  string                 `json:"provider"`
	Message   map[string]interface{} `json:"message,omitempty"`
	IsDelta   bool                   `json:"is_delta,omitempty"`
	Raw       string                 `json:"raw,omitempty"`
}

// StderrEvent stderr 输出事件。
type StderrEvent struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// ProcessHealth 进程健康状态。
type ProcessHealth string

const (
	HealthOK      ProcessHealth = "ok"
	HealthSlow    ProcessHealth = "slow"
	HealthStuck   ProcessHealth = "stuck"
	HealthHanging ProcessHealth = "hanging"
	HealthCrashed ProcessHealth = "crashed"
)
