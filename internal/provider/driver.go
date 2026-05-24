package provider

import (
	"context"
	"io"
	"time"
)

// ProviderDriver is the unified interface that every AI provider must implement.
// All providers implement every method without distinguishing interactive/batch;
// differences are handled internally via the operation primitives provided by SessionHandle.
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

	// SetModel switches the model.
	// Claude: sends a control_request via stdin, takes effect immediately.
	// Others: updates session config, takes effect on next restart.
	SetModel(session SessionHandle, model string) error

	// SetPermissionMode switches the permission mode.
	// Claude: sends a control_request via stdin.
	// Others: no-op or updates config.
	SetPermissionMode(session SessionHandle, mode string) error

	// UpdateEnvironmentVariables updates runtime environment variables.
	// Claude: sends update_environment_variables via stdin, takes effect on next API call.
	// Others: updates session config, takes effect on next restart.
	UpdateEnvironmentVariables(session SessionHandle, vars map[string]string) error

	// WaitForInit waits for session initialization to complete.
	// Claude: waits for control_response(init_1).
	// Others: returns immediately (batch processes need no handshake).
	WaitForInit(session SessionHandle, timeout time.Duration) error

	OnProcessStart(ctx context.Context, session SessionHandle, pid int) error
	OnProcessExit(session SessionHandle, exitCode int, err error)
}

// CapabilityDiscoverer is an optional extension interface for pre-start capability discovery.
type CapabilityDiscoverer interface {
	DiscoverCapabilities(ctx context.Context) (*Capabilities, error)
}

// Capabilities represents a provider's capability configuration.
type Capabilities struct {
	Models          []string          `json:"models,omitempty"`
	PermissionModes []string          `json:"permission_modes,omitempty"`
	Extensions      map[string]string `json:"extensions,omitempty"`
}

// SessionHandle is the set of operation primitives exposed by the runtime to drivers.
// The runtime provides mechanisms; the driver decides policy.
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

	// UpdateConfig atomically updates session config (used by batch providers to persist SetModel/UpdateEnv changes).
	UpdateConfig(fn func(*SessionConfig))

	// SendControlRequest sends a control request and waits for the matching response.
	// Returns a response channel; timeout is controlled by the caller.
	// Used only in Claude interactive mode.
	SendControlRequest(requestID string, payload []byte) (<-chan ControlResponse, error)

	// MarkInitialized marks the session as initialized.
	MarkInitialized()

	// WaitForInit waits for session initialization to complete.
	WaitForInit(timeout time.Duration) error
}

// ControlResponse is the response to a control_request.
type ControlResponse struct {
	Data map[string]interface{}
	Err  error
}

// SessionState represents the lifecycle state of a session.
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

// StdinWriter is an abstraction over the stdin pipe for testability.
type StdinWriter interface {
	io.Writer
	io.Closer
}
