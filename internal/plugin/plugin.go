// Package plugin provides plugin management functionality for Claude Code plugins
package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Plugin represents an installed plugin
type Plugin struct {
	ID          string         `json:"id"`
	Metadata    PluginMetadata `json:"metadata"`
	InstallPath string         `json:"install_path"`
	Enabled     bool           `json:"enabled"`
	InstalledAt string         `json:"installed_at"`
}

// PluginMetadata contains plugin metadata from .claude-plugin/plugin.json
type PluginMetadata struct {
	Name        string       `json:"name"`
	Version     string       `json:"version"`
	Description string       `json:"description"`
	Author      PluginAuthor `json:"author"`
	Homepage    string       `json:"homepage,omitempty"`
	Repository  string       `json:"repository,omitempty"`
	License     string       `json:"license,omitempty"`
	Keywords    []string     `json:"keywords,omitempty"`
}

// PluginAuthor represents plugin author information
type PluginAuthor struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

// PluginAgent represents an agent from a plugin
type PluginAgent struct {
	PluginID     string `json:"plugin_id"`
	PluginName   string `json:"plugin_name"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Tools        string `json:"tools,omitempty"`
	Color        string `json:"color,omitempty"`
	Model        string `json:"model,omitempty"`
	Instructions string `json:"instructions"`
	FilePath     string `json:"file_path"`
}

// PluginCommand represents a slash command from a plugin
type PluginCommand struct {
	PluginID     string   `json:"plugin_id"`
	PluginName   string   `json:"plugin_name"`
	Name         string   `json:"name"`
	Description  string   `json:"description,omitempty"`
	AllowedTools []string `json:"allowed_tools,omitempty"`
	Content      string   `json:"content"`
	FilePath     string   `json:"file_path"`
	FullCommand  string   `json:"full_command"` // e.g., "/superpowers:brainstorm"
}

// PluginSkill represents a skill from a plugin
type PluginSkill struct {
	PluginID    string `json:"plugin_id"`
	PluginName  string `json:"plugin_name"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Content     string `json:"content"`
	FolderPath  string `json:"folder_path"`
}

// PluginHook represents a hook configuration from a plugin
type PluginHook struct {
	EventType  string `json:"event_type"`
	Matcher    string `json:"matcher,omitempty"`
	Command    string `json:"command"`
	PluginID   string `json:"plugin_id"`
	PluginName string `json:"plugin_name"`
}

// PluginContents represents all contents of a plugin
type PluginContents struct {
	Plugin   Plugin          `json:"plugin"`
	Agents   []PluginAgent   `json:"agents"`
	Commands []PluginCommand `json:"commands"`
	Skills   []PluginSkill   `json:"skills"`
	Hooks    []PluginHook    `json:"hooks"`
}

// InstalledPluginRecord represents the structure in installed_plugins.json
type InstalledPluginRecord struct {
	Scope        string `json:"scope"`
	InstallPath  string `json:"installPath"`
	Version      string `json:"version"`
	InstalledAt  string `json:"installedAt"`
	LastUpdated  string `json:"lastUpdated"`
	GitCommitSha string `json:"gitCommitSha,omitempty"`
	IsLocal      bool   `json:"isLocal"`
}

// InstalledPluginsFile represents the structure of installed_plugins.json
type InstalledPluginsFile struct {
	Version int                                `json:"version"`
	Plugins map[string][]InstalledPluginRecord `json:"plugins"`
}

// Manager provides plugin management functionality
type Manager struct {
	pluginsDir string
}

// NewManager creates a new plugin manager
func NewManager(claudeDir string) *Manager {
	return &Manager{
		pluginsDir: filepath.Join(claudeDir, "plugins"),
	}
}

// ListInstalled returns all installed plugins
func (m *Manager) ListInstalled() ([]Plugin, error) {
	installedFile := filepath.Join(m.pluginsDir, "installed_plugins.json")
	data, err := os.ReadFile(installedFile)
	if err != nil {
		if os.IsNotExist(err) {
			return []Plugin{}, nil
		}
		return nil, fmt.Errorf("failed to read installed_plugins.json: %w", err)
	}

	var installed InstalledPluginsFile
	if err := json.Unmarshal(data, &installed); err != nil {
		return nil, fmt.Errorf("failed to parse installed_plugins.json: %w", err)
	}

	var plugins []Plugin
	for pluginID, records := range installed.Plugins {
		for _, record := range records {
			metadata, err := m.readPluginMetadataWithFallback(pluginID, record.InstallPath)
			if err != nil {
				// Skip plugins with missing metadata
				continue
			}

			plugins = append(plugins, Plugin{
				ID:          pluginID,
				Metadata:    metadata,
				InstallPath: record.InstallPath,
				Enabled:     true, // All installed plugins are enabled by default
				InstalledAt: record.InstalledAt,
			})
		}
	}

	return plugins, nil
}

// GetDetails returns details for a specific plugin
func (m *Manager) GetDetails(id string) (*Plugin, error) {
	plugins, err := m.ListInstalled()
	if err != nil {
		return nil, err
	}

	for _, p := range plugins {
		if p.ID == id {
			return &p, nil
		}
	}

	return nil, fmt.Errorf("plugin not found: %s", id)
}

// GetContents returns all contents of a plugin
func (m *Manager) GetContents(id string) (*PluginContents, error) {
	plugin, err := m.GetDetails(id)
	if err != nil {
		return nil, err
	}

	contents := &PluginContents{
		Plugin:   *plugin,
		Agents:   []PluginAgent{},
		Commands: []PluginCommand{},
		Skills:   []PluginSkill{},
		Hooks:    []PluginHook{},
	}

	// Parse plugin ID to get plugin name
	// parts := strings.Split(id, "@")
	// pluginName := parts[0]

	// Load agents
	agents, _ := m.ListAgents(id)
	contents.Agents = agents

	// Load commands
	commands, _ := m.ListCommands(id)
	contents.Commands = commands

	// Load skills
	skills, _ := m.ListSkills(id)
	contents.Skills = skills

	// Load hooks
	hooks, _ := m.ListHooks(id)
	contents.Hooks = hooks

	return contents, nil
}

// ListAgents returns all agents from a plugin
func (m *Manager) ListAgents(pluginID string) ([]PluginAgent, error) {
	plugin, err := m.GetDetails(pluginID)
	if err != nil {
		return nil, err
	}

	agentsDir := filepath.Join(plugin.InstallPath, "agents")
	if _, err := os.Stat(agentsDir); os.IsNotExist(err) {
		return []PluginAgent{}, nil
	}

	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read agents directory: %w", err)
	}

	var agents []PluginAgent
	pluginName := strings.Split(pluginID, "@")[0]

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		agentPath := filepath.Join(agentsDir, entry.Name())
		content, err := os.ReadFile(agentPath)
		if err != nil {
			continue
		}

		// Parse agent markdown file (simplified - could parse frontmatter properly)
		agentName := strings.TrimSuffix(entry.Name(), ".md")
		agents = append(agents, PluginAgent{
			PluginID:     pluginID,
			PluginName:   pluginName,
			Name:         agentName,
			Instructions: string(content),
			FilePath:     agentPath,
		})
	}

	return agents, nil
}

// ListCommands returns all commands from a plugin
func (m *Manager) ListCommands(pluginID string) ([]PluginCommand, error) {
	plugin, err := m.GetDetails(pluginID)
	if err != nil {
		return nil, err
	}

	commandsDir := filepath.Join(plugin.InstallPath, "commands")
	if _, err := os.Stat(commandsDir); os.IsNotExist(err) {
		return []PluginCommand{}, nil
	}

	entries, err := os.ReadDir(commandsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read commands directory: %w", err)
	}

	var commands []PluginCommand
	pluginName := strings.Split(pluginID, "@")[0]

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		cmdPath := filepath.Join(commandsDir, entry.Name())
		content, err := os.ReadFile(cmdPath)
		if err != nil {
			continue
		}

		cmdName := strings.TrimSuffix(entry.Name(), ".md")
		fullCommand := fmt.Sprintf("/%s:%s", pluginName, cmdName)

		commands = append(commands, PluginCommand{
			PluginID:    pluginID,
			PluginName:  pluginName,
			Name:        cmdName,
			Content:     string(content),
			FilePath:    cmdPath,
			FullCommand: fullCommand,
		})
	}

	return commands, nil
}

// ListSkills returns all skills from a plugin
func (m *Manager) ListSkills(pluginID string) ([]PluginSkill, error) {
	plugin, err := m.GetDetails(pluginID)
	if err != nil {
		return nil, err
	}

	skillsDir := filepath.Join(plugin.InstallPath, "skills")
	if _, err := os.Stat(skillsDir); os.IsNotExist(err) {
		return []PluginSkill{}, nil
	}

	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read skills directory: %w", err)
	}

	var skills []PluginSkill
	pluginName := strings.Split(pluginID, "@")[0]

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		skillPath := filepath.Join(skillsDir, entry.Name(), "SKILL.md")
		if _, err := os.Stat(skillPath); os.IsNotExist(err) {
			continue
		}

		content, err := os.ReadFile(skillPath)
		if err != nil {
			continue
		}

		skills = append(skills, PluginSkill{
			PluginID:   pluginID,
			PluginName: pluginName,
			Name:       entry.Name(),
			Content:    string(content),
			FolderPath: filepath.Join(skillsDir, entry.Name()),
		})
	}

	return skills, nil
}

// ListHooks returns all hooks from a plugin
func (m *Manager) ListHooks(pluginID string) ([]PluginHook, error) {
	plugin, err := m.GetDetails(pluginID)
	if err != nil {
		return nil, err
	}

	hooksDir := filepath.Join(plugin.InstallPath, "hooks")
	if _, err := os.Stat(hooksDir); os.IsNotExist(err) {
		return []PluginHook{}, nil
	}

	// For now, return empty array
	// Full implementation would parse hooks configuration
	// pluginName := strings.Split(pluginID, "@")[0]
	return []PluginHook{}, nil
}

// GetAgent returns a specific agent from a plugin
func (m *Manager) GetAgent(pluginID, agentName string) (*PluginAgent, error) {
	agents, err := m.ListAgents(pluginID)
	if err != nil {
		return nil, err
	}

	for _, agent := range agents {
		if agent.Name == agentName {
			return &agent, nil
		}
	}

	return nil, fmt.Errorf("agent not found: %s/%s", pluginID, agentName)
}

// GetCommand returns a specific command from a plugin
func (m *Manager) GetCommand(pluginID, commandName string) (*PluginCommand, error) {
	commands, err := m.ListCommands(pluginID)
	if err != nil {
		return nil, err
	}

	for _, cmd := range commands {
		if cmd.Name == commandName {
			return &cmd, nil
		}
	}

	return nil, fmt.Errorf("command not found: %s/%s", pluginID, commandName)
}

// GetSkill returns a specific skill from a plugin
func (m *Manager) GetSkill(pluginID, skillName string) (*PluginSkill, error) {
	skills, err := m.ListSkills(pluginID)
	if err != nil {
		return nil, err
	}

	for _, skill := range skills {
		if skill.Name == skillName {
			return &skill, nil
		}
	}

	return nil, fmt.Errorf("skill not found: %s/%s", pluginID, skillName)
}

// readPluginMetadataWithFallback reads plugin metadata with multiple fallback strategies:
// 1. Try .claude-plugin/plugin.json in install path
// 2. Try .claude-plugin/marketplace.json in install path
// 3. Try marketplaces directory marketplace.json (parse pluginID to find marketplace)
func (m *Manager) readPluginMetadataWithFallback(pluginID, installPath string) (PluginMetadata, error) {
	// Strategy 1: Try plugin.json
	metadataPath := filepath.Join(installPath, ".claude-plugin", "plugin.json")
	if data, err := os.ReadFile(metadataPath); err == nil {
		var metadata PluginMetadata
		if err := json.Unmarshal(data, &metadata); err == nil {
			if metadata.Keywords == nil {
				metadata.Keywords = []string{}
			}
			return metadata, nil
		}
	}

	// Strategy 2: Try marketplace.json in install path
	marketplacePath := filepath.Join(installPath, ".claude-plugin", "marketplace.json")
	if data, err := os.ReadFile(marketplacePath); err == nil {
		var marketplace MarketplaceFile
		if err := json.Unmarshal(data, &marketplace); err == nil {
			return PluginMetadata{
				Name:        marketplace.Name,
				Version:     marketplace.Metadata.Version,
				Description: marketplace.Metadata.Description,
				Author: PluginAuthor{
					Name:  marketplace.Owner.Name,
					Email: marketplace.Owner.Email,
				},
				Keywords: []string{},
			}, nil
		}
	}

	// Strategy 3: Try to find in marketplaces directory
	// pluginID format: "plugin-name@marketplace-name"
	return m.readFromMarketplacesDir(pluginID)
}

// readFromMarketplacesDir reads plugin metadata from the marketplaces directory
func (m *Manager) readFromMarketplacesDir(pluginID string) (PluginMetadata, error) {
	// Parse pluginID: "plugin-name@marketplace-name"
	parts := strings.Split(pluginID, "@")
	if len(parts) != 2 {
		return PluginMetadata{}, fmt.Errorf("invalid plugin ID format: %s", pluginID)
	}
	pluginName := parts[0]
	marketplaceName := parts[1]

	// Read marketplace.json from marketplaces directory
	marketplacePath := filepath.Join(m.pluginsDir, "marketplaces", marketplaceName, ".claude-plugin", "marketplace.json")
	data, err := os.ReadFile(marketplacePath)
	if err != nil {
		return PluginMetadata{}, fmt.Errorf("failed to read marketplace.json from marketplaces dir: %w", err)
	}

	var marketplace MarketplaceFile
	if err := json.Unmarshal(data, &marketplace); err != nil {
		return PluginMetadata{}, fmt.Errorf("failed to parse marketplace.json: %w", err)
	}

	// Find plugin in marketplace plugins array
	for _, p := range marketplace.Plugins {
		if p.Name == pluginName {
			author := PluginAuthor{
				Name:  p.Author.Name,
				Email: p.Author.Email,
			}
			// Fallback to marketplace owner if plugin author is empty
			if author.Name == "" {
				author.Name = marketplace.Owner.Name
				author.Email = marketplace.Owner.Email
			}
			keywords := p.Keywords
			if keywords == nil {
				keywords = []string{}
			}
			return PluginMetadata{
				Name:        p.Name,
				Version:     p.Version,
				Description: p.Description,
				Author:      author,
				License:     p.License,
				Keywords:    keywords,
			}, nil
		}
	}

	return PluginMetadata{}, fmt.Errorf("plugin %s not found in marketplace %s", pluginName, marketplaceName)
}

// readPluginMetadata reads plugin metadata from .claude-plugin/plugin.json
// Falls back to marketplace.json if plugin.json doesn't exist
func (m *Manager) readPluginMetadata(installPath string) (PluginMetadata, error) {
	metadataPath := filepath.Join(installPath, ".claude-plugin", "plugin.json")
	data, err := os.ReadFile(metadataPath)
	if err != nil {
		// Fallback to marketplace.json
		return m.readMarketplaceMetadata(installPath)
	}

	var metadata PluginMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return PluginMetadata{}, fmt.Errorf("failed to parse plugin.json: %w", err)
	}

	// Ensure keywords array is initialized
	if metadata.Keywords == nil {
		metadata.Keywords = []string{}
	}

	return metadata, nil
}

// MarketplaceFile represents the structure of marketplace.json
type MarketplaceFile struct {
	Name  string `json:"name"`
	Owner struct {
		Name  string `json:"name"`
		Email string `json:"email,omitempty"`
	} `json:"owner"`
	Metadata struct {
		Description string `json:"description"`
		Version     string `json:"version"`
	} `json:"metadata"`
	Plugins []MarketplacePlugin `json:"plugins"`
}

// MarketplacePlugin represents a plugin entry in marketplace.json
type MarketplacePlugin struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Source      any    `json:"source"` // Can be string or object
	Author      struct {
		Name  string `json:"name"`
		Email string `json:"email,omitempty"`
	} `json:"author"`
	License  string   `json:"license,omitempty"`
	Keywords []string `json:"keywords,omitempty"`
}

// readMarketplaceMetadata reads metadata from .claude-plugin/marketplace.json as fallback
func (m *Manager) readMarketplaceMetadata(installPath string) (PluginMetadata, error) {
	marketplacePath := filepath.Join(installPath, ".claude-plugin", "marketplace.json")
	data, err := os.ReadFile(marketplacePath)
	if err != nil {
		return PluginMetadata{}, fmt.Errorf("failed to read plugin.json or marketplace.json: %w", err)
	}

	var marketplace MarketplaceFile
	if err := json.Unmarshal(data, &marketplace); err != nil {
		return PluginMetadata{}, fmt.Errorf("failed to parse marketplace.json: %w", err)
	}

	// Convert marketplace metadata to plugin metadata
	return PluginMetadata{
		Name:        marketplace.Name,
		Version:     marketplace.Metadata.Version,
		Description: marketplace.Metadata.Description,
		Author: PluginAuthor{
			Name:  marketplace.Owner.Name,
			Email: marketplace.Owner.Email,
		},
		Keywords: []string{},
	}, nil
}
