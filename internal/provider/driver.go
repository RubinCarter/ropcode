package provider

import (
	"context"
	"io"
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
