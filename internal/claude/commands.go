package claude

// CommandType represents the type of command (claude or codex)
type CommandType string

const (
	CommandTypeClaude CommandType = "claude"
	CommandTypeCodex  CommandType = "codex"
)

// SlashCommand represents a slash command configuration
type SlashCommand struct {
	ID               string      `json:"id"`
	CommandType      CommandType `json:"command_type"`
	Name             string      `json:"name"`
	FullCommand      string      `json:"full_command"`
	Scope            string      `json:"scope"` // "default", "user", "project", "plugin"
	Namespace        *string     `json:"namespace,omitempty"`
	FilePath         string      `json:"file_path"`
	Content          string      `json:"content"`
	Description      *string     `json:"description,omitempty"`
	AllowedTools     []string    `json:"allowed_tools"`
	ArgumentHint     *string     `json:"argument_hint,omitempty"`
	HasBashCommands  bool        `json:"has_bash_commands"`
	HasFileRefs      bool        `json:"has_file_references"`
	AcceptsArguments bool        `json:"accepts_arguments"`
	PluginID         *string     `json:"plugin_id,omitempty"`
	PluginName       *string     `json:"plugin_name,omitempty"`
}
