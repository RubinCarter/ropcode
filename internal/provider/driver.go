package provider

import (
	"context"
	"io"
	"time"
)

// ProviderDriver 是每个 AI provider 必须实现的统一接口。
// 所有 provider 实现全部方法——不区分 interactive/batch，
// 差异通过 SessionHandle 提供的操作原语在 driver 内部消化。
type ProviderDriver interface {
	ID() string
	BinaryName() string
	BinaryCandidates() []string

	BuildArgs(config SessionConfig) []string
	EnvVars(config SessionConfig) map[string]string

	ParseOutput(line []byte) *OutputEvent
	ParseStderr(line []byte) *StderrEvent

	SendMessage(session SessionHandle, msg string) error
	Interrupt(session SessionHandle) error

	// SetModel 切换模型。
	// Claude: stdin 发 control_request，立即生效
	// 其他: 更新 session config，下次 restart 生效
	SetModel(session SessionHandle, model string) error

	// SetPermissionMode 切换权限模式。
	// Claude: stdin 发 control_request
	// 其他: no-op 或更新 config
	SetPermissionMode(session SessionHandle, mode string) error

	// UpdateEnvironmentVariables 更新运行时环境变量。
	// Claude: stdin 发 update_environment_variables，下次 API 调用生效
	// 其他: 更新 session config，下次 restart 生效
	UpdateEnvironmentVariables(session SessionHandle, vars map[string]string) error

	// WaitForInit 等待会话初始化完成。
	// Claude: 等待 control_response(init_1)
	// 其他: 立即返回（batch 进程无需握手）
	WaitForInit(session SessionHandle, timeout time.Duration) error

	OnProcessStart(ctx context.Context, pid int) error
	OnProcessExit(session SessionHandle, exitCode int, err error)
}

// CapabilityDiscoverer 是可选扩展接口，用于启动前预热能力发现。
type CapabilityDiscoverer interface {
	DiscoverCapabilities(ctx context.Context) (*Capabilities, error)
}

// Capabilities 表示 provider 的能力配置。
type Capabilities struct {
	Models          []string          `json:"models,omitempty"`
	PermissionModes []string          `json:"permission_modes,omitempty"`
	Extensions      map[string]string `json:"extensions,omitempty"`
}

// SessionHandle 是 runtime 暴露给 driver 的操作原语。
// Runtime 提供机制，driver 决定策略。
type SessionHandle interface {
	WriteStdin(data []byte) error
	Kill() error

	EnqueueMessage(msg string)
	DequeueMessage() (string, bool)

	RestartWithConfig(config SessionConfig) error

	GetState() SessionState
	GetProviderSessionID() string
	GetConfig() SessionConfig
	SetProviderSessionID(id string)

	// UpdateConfig 原子更新 session config（用于 batch provider 记住 SetModel/UpdateEnv 的变更）。
	UpdateConfig(fn func(*SessionConfig))

	// SendControlRequest 发送 control request 并等待匹配的 response。
	// 返回 response channel，超时由调用方控制。
	// 仅 Claude interactive mode 使用。
	SendControlRequest(requestID string, payload []byte) (<-chan ControlResponse, error)

	// MarkInitialized 标记会话初始化完成。
	MarkInitialized()

	// WaitForInit 等待会话初始化完成。
	WaitForInit(timeout time.Duration) error
}

// ControlResponse 是 control_request 的响应。
type ControlResponse struct {
	Data map[string]interface{}
	Err  error
}

// SessionState 表示会话的生命周期状态。
type SessionState string

const (
	StateCreated    SessionState = "created"
	StateStarting   SessionState = "starting"
	StateRunning    SessionState = "running"
	StateCancelling SessionState = "cancelling"
	StateCompleted  SessionState = "completed"
	StateFailed     SessionState = "failed"
	StateCancelled  SessionState = "cancelled"
)

// StdinWriter 是对 stdin pipe 的抽象，方便测试。
type StdinWriter interface {
	io.Writer
	io.Closer
}
