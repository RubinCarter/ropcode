// internal/database/models.go
package database

import "time"

// ProviderApiConfig stores API configuration for AI providers
type ProviderApiConfig struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	ProviderID string    `json:"provider_id"`
	BaseURL    string    `json:"base_url,omitempty"`
	AuthToken  string    `json:"auth_token,omitempty"`
	IsDefault  bool      `json:"is_default"`
	IsBuiltin  bool      `json:"is_builtin"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ProjectIndex stores project metadata
type ProjectIndex struct {
	// Computed fields for frontend compatibility (populated from first provider)
	ID   string `json:"id,omitempty"`
	Path string `json:"path,omitempty"`
	// Original fields
	Name          string           `json:"name"`
	AddedAt       int64            `json:"added_at"`
	CreatedAt     int64            `json:"created_at,omitempty"`
	LastAccessed  int64            `json:"last_accessed"`
	Description   string           `json:"description,omitempty"`
	Available     bool             `json:"available"`
	Providers     []ProviderInfo   `json:"providers"`
	Workspaces    []WorkspaceIndex `json:"workspaces"`
	LastProvider  string           `json:"last_provider"`
	ProjectType   string           `json:"project_type,omitempty"`
	HasGitSupport *bool            `json:"has_git_support,omitempty"`
}

// ProviderInfo stores provider configuration for a project
type ProviderInfo struct {
	ID            string `json:"id"`
	ProviderID    string `json:"provider_id"`
	Path          string `json:"path"`
	ProviderApiID string `json:"provider_api_id,omitempty"`
}

// WorkspaceIndex stores workspace metadata
type WorkspaceIndex struct {
	// Computed field for frontend compatibility (populated from first provider)
	ID string `json:"id,omitempty"`
	// Original fields
	Name         string         `json:"name"`
	AddedAt      int64          `json:"added_at"`
	Providers    []ProviderInfo `json:"providers"`
	LastProvider string         `json:"last_provider"`
	Branch       string         `json:"branch,omitempty"`
}

// Setting stores application settings
type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Agent represents a CC Agent stored in the database
type Agent struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Icon          string    `json:"icon"`
	SystemPrompt  string    `json:"system_prompt"`
	DefaultTask   string    `json:"default_task,omitempty"`
	Model         string    `json:"model"`
	ProviderApiID string    `json:"provider_api_id,omitempty"`
	Hooks         string    `json:"hooks,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// AgentRun represents a single agent execution run
type AgentRun struct {
	ID               int64      `json:"id"`
	AgentID          int64      `json:"agent_id"`
	AgentName        string     `json:"agent_name"`
	AgentIcon        string     `json:"agent_icon"`
	Task             string     `json:"task"`
	Model            string     `json:"model"`
	ProjectPath      string     `json:"project_path"`
	SessionID        string     `json:"session_id"`
	Status           string     `json:"status"` // pending, running, completed, failed, cancelled
	PID              int        `json:"pid,omitempty"`
	ProcessStartedAt *time.Time `json:"process_started_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
}

// ThinkingLevel represents a thinking depth configuration for a model
type ThinkingLevel struct {
	ID        string `json:"id"`         // Unique identifier: "auto", "think", "ultrathink"
	Name      string `json:"name"`       // Display name
	Budget    any    `json:"budget"`     // Provider-specific: phrase for Claude/Gemini ("think", "ultrathink"), reasoning_effort for Codex ("low", "high")
	IsDefault bool   `json:"is_default"` // Whether this is the default level for the model
}

// ModelConfig stores model configuration with thinking levels
type ModelConfig struct {
	ID             string          `json:"id"`              // UUID
	ModelID        string          `json:"model_id"`        // Model identifier: "sonnet", "opus", or full model ID
	ProviderID     string          `json:"provider_id"`     // Provider: "claude", "openai", "gemini"
	DisplayName    string          `json:"display_name"`    // User-friendly display name
	Description    string          `json:"description"`     // Model description
	IsBuiltin      bool            `json:"is_builtin"`      // Built-in models cannot be modified or deleted
	IsEnabled      bool            `json:"is_enabled"`      // User can disable models
	IsDefault      bool            `json:"is_default"`      // Default model for the provider
	ThinkingLevels []ThinkingLevel `json:"thinking_levels"` // Available thinking levels (empty = no thinking support)
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}
