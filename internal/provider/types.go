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

// Message 是所有 provider 共用的历史消息格式。
// 各 provider 的 history reader 将自己的格式转换为此类型。
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

// MessageIndex 是消息在 JSONL 文件中的行号索引。
type MessageIndex struct {
	LineNumbers []int `json:"line_numbers"`
	TotalLines  int   `json:"total_lines"`
}

// HistorySessionInfo 是会话历史的元数据（从本地文件系统读取）。
type HistorySessionInfo struct {
	ID               string `json:"id"`
	ProjectID        string `json:"project_id"`
	ProjectPath      string `json:"project_path"`
	CreatedAt        int64  `json:"created_at"`
	MessageTimestamp string `json:"message_timestamp,omitempty"`
	FirstMessage     string `json:"first_message,omitempty"`
}

// HistorySessionsResult 是会话列表查询结果。
type HistorySessionsResult struct {
	Sessions []HistorySessionInfo
	HasMore  bool
}
