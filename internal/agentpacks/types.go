package agentpacks

type PackManifest struct {
	SchemaVersion int                 `json:"schema_version"`
	ID            string              `json:"id"`
	Version       string              `json:"version"`
	Name          string              `json:"name"`
	Description   string              `json:"description,omitempty"`
	Agents        []AgentDefinition   `json:"agents"`
	Compatibility Compatibility       `json:"compatibility,omitempty"`
	Migrations    map[string]PackPlan `json:"migrations,omitempty"`
}

type Compatibility struct {
	Ropcode string `json:"ropcode,omitempty"`
}

type AgentDefinition struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Icon              string            `json:"icon,omitempty"`
	Description       string            `json:"description,omitempty"`
	Role              string            `json:"role"`
	Capabilities      []string          `json:"capabilities,omitempty"`
	DefaultTask       string            `json:"default_task,omitempty"`
	SuggestedTriggers []TriggerTemplate `json:"suggested_triggers,omitempty"`
	Metadata          map[string]any    `json:"metadata,omitempty"`
}

type TriggerTemplate struct {
	Mode           string         `json:"mode"`
	Event          string         `json:"event,omitempty"`
	EventType      string         `json:"event_type,omitempty"`
	SessionType    string         `json:"session_type,omitempty"`
	SessionAgentID string         `json:"session_agent_id,omitempty"`
	AgentID        string         `json:"agent_id,omitempty"`
	Schedule       string         `json:"schedule,omitempty"`
	Scope          map[string]any `json:"scope,omitempty"`
	Timezone       string         `json:"timezone,omitempty"`
}

type PackIndex struct {
	SchemaVersion int           `json:"schema_version"`
	Packs         []PackListing `json:"packs"`
}

type PackListing struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
}

type InstallSource struct {
	Type string `json:"type"`
	Repo string `json:"repo,omitempty"`
	Path string `json:"path,omitempty"`
	Ref  string `json:"ref,omitempty"`
	URL  string `json:"url,omitempty"`
}

type InstalledPack struct {
	PackID           string                          `json:"pack_id"`
	InstalledVersion string                          `json:"installed_version"`
	Source           InstallSource                   `json:"source"`
	InstalledAt      string                          `json:"installed_at"`
	UpdatedAt        string                          `json:"updated_at"`
	Agents           map[string]InstalledAgentConfig `json:"agents"`
}

type InstalledAgentConfig struct {
	Enabled  bool            `json:"enabled"`
	Runtime  RuntimeConfig   `json:"runtime"`
	Triggers []TriggerConfig `json:"triggers,omitempty"`
}

type RuntimeConfig struct {
	Provider       string            `json:"provider"`
	Model          string            `json:"model"`
	ProviderAPIID  string            `json:"provider_api_id,omitempty"`
	PermissionMode string            `json:"permission_mode,omitempty"`
	Config         map[string]string `json:"config,omitempty"`
}

type TriggerConfig struct {
	Mode           string         `json:"mode"`
	Enabled        bool           `json:"enabled"`
	Event          string         `json:"event,omitempty"`
	EventType      string         `json:"event_type,omitempty"`
	SessionType    string         `json:"session_type,omitempty"`
	SessionAgentID string         `json:"session_agent_id,omitempty"`
	AgentID        string         `json:"agent_id,omitempty"`
	Scope          map[string]any `json:"scope,omitempty"`
	Schedule       string         `json:"schedule,omitempty"`
	Timezone       string         `json:"timezone,omitempty"`
}

type CreateLocalPackRequest struct {
	PackID      string                `json:"pack_id,omitempty"`
	Name        string                `json:"name"`
	Description string                `json:"description,omitempty"`
	Version     string                `json:"version,omitempty"`
	Agent       ManualAgentDefinition `json:"agent"`
	Runtime     RuntimeConfig         `json:"runtime"`
	Enabled     bool                  `json:"enabled"`
	Triggers    []TriggerConfig       `json:"triggers,omitempty"`
}

type ManualAgentDefinition struct {
	ID          string        `json:"id,omitempty"`
	Name        string        `json:"name"`
	Icon        string        `json:"icon,omitempty"`
	Description string        `json:"description,omitempty"`
	RolePrompt  string        `json:"role_prompt"`
	Skills      []ManualSkill `json:"skills,omitempty"`
	DefaultTask string        `json:"default_task,omitempty"`
}

type ManualSkill struct {
	ID           string `json:"id,omitempty"`
	Name         string `json:"name,omitempty"`
	Description  string `json:"description,omitempty"`
	SourcePath   string `json:"source_path,omitempty"`
	Instructions string `json:"instructions"`
}

type InstalledPackSummary struct {
	PackID           string         `json:"pack_id"`
	Name             string         `json:"name"`
	Description      string         `json:"description,omitempty"`
	InstalledVersion string         `json:"installed_version"`
	LatestVersion    string         `json:"latest_version,omitempty"`
	UpdateAvailable  bool           `json:"update_available"`
	Source           InstallSource  `json:"source"`
	Path             string         `json:"path"`
	Agents           []AgentSummary `json:"agents"`
}

type InstalledPackDetail struct {
	Path     string        `json:"path"`
	Manifest PackManifest  `json:"manifest"`
	Install  InstalledPack `json:"install"`
}

type AgentSummary struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Icon     string          `json:"icon,omitempty"`
	Enabled  bool            `json:"enabled"`
	Runtime  RuntimeConfig   `json:"runtime"`
	Triggers []TriggerConfig `json:"triggers,omitempty"`
}

type InstallOptions struct {
	Source  InstallSource                   `json:"source"`
	Agents  map[string]InstalledAgentConfig `json:"agents,omitempty"`
	Replace bool                            `json:"replace,omitempty"`
}

type UpdateResult struct {
	PackID          string `json:"pack_id"`
	PreviousVersion string `json:"previous_version"`
	NewVersion      string `json:"new_version"`
	Updated         bool   `json:"updated"`
	BackupPath      string `json:"backup_path,omitempty"`
}

type PackPlan struct {
	Agents map[string]string `json:"agents,omitempty"`
}
