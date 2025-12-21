// internal/provider/interface.go
package provider

import "context"

// ModelInfo represents information about a supported model
type ModelInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// SessionConfig contains configuration for starting a provider session
type SessionConfig struct {
	ProjectPath   string `json:"project_path"`
	Prompt        string `json:"prompt"`
	Model         string `json:"model"`
	ProviderApiID string `json:"provider_api_id,omitempty"`
}

// Installation represents a discovered provider installation
type Installation struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Source  string `json:"source"` // "discovered", "configured", etc.
}

// Provider defines the interface that all AI providers must implement
type Provider interface {
	// ID returns the unique identifier for this provider (e.g., "claude", "openai")
	ID() string

	// Name returns the human-readable name of the provider
	Name() string

	// SupportedModels returns a list of models supported by this provider
	SupportedModels() []ModelInfo

	// DiscoverInstallations attempts to find installed instances of the provider
	DiscoverInstallations() ([]Installation, error)

	// StartSession starts a new session with the provider
	StartSession(ctx context.Context, config SessionConfig) error

	// TerminateSession terminates an active session
	TerminateSession(ctx context.Context, projectPath string) error
}
