package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

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

// CommandFrontmatter represents YAML frontmatter in command files
type CommandFrontmatter struct {
	Description  string   `yaml:"description"`
	AllowedTools []string `yaml:"allowed-tools"`
	ArgumentHint string   `yaml:"argument-hint"`
}

// InstalledPluginsFile represents the structure of installed_plugins.json
type InstalledPluginsFile struct {
	Plugins map[string][]PluginEntry `json:"plugins"`
}

// PluginEntry represents a single plugin installation entry
type PluginEntry struct {
	InstallPath string `json:"installPath"`
}

// ListSlashCommands lists all slash commands (default + user + project + plugin)
func ListSlashCommands(projectPath string) ([]SlashCommand, error) {
	var commands []SlashCommand

	// 1. Add default/built-in commands
	commands = append(commands, createDefaultCommands()...)

	// Get home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	// 2. Load project commands if projectPath is provided
	if projectPath != "" {
		// Claude project commands
		claudeProjectDir := filepath.Join(projectPath, ".claude", "commands")
		projectCmds, _ := loadCommandsFromDir(claudeProjectDir, "project", CommandTypeClaude)
		commands = append(commands, projectCmds...)

		// Codex project commands
		codexProjectDir := filepath.Join(projectPath, ".codex", "prompts")
		codexProjectCmds, _ := loadCommandsFromDir(codexProjectDir, "project", CommandTypeCodex)
		commands = append(commands, codexProjectCmds...)
	}

	// 3. Load user commands
	// Claude user commands
	claudeUserDir := filepath.Join(homeDir, ".claude", "commands")
	userCmds, _ := loadCommandsFromDir(claudeUserDir, "user", CommandTypeClaude)
	commands = append(commands, userCmds...)

	// Codex user commands
	codexUserDir := filepath.Join(homeDir, ".codex", "prompts")
	codexUserCmds, _ := loadCommandsFromDir(codexUserDir, "user", CommandTypeCodex)
	commands = append(commands, codexUserCmds...)

	// 4. Load plugin commands
	pluginCmds := loadPluginCommands(homeDir)
	commands = append(commands, pluginCmds...)

	return commands, nil
}

// createDefaultCommands returns built-in slash commands
func createDefaultCommands() []SlashCommand {
	commands := []SlashCommand{
		// Claude default commands
		{
			ID:               "default-add-dir",
			CommandType:      CommandTypeClaude,
			Name:             "add-dir",
			FullCommand:      "/add-dir",
			Scope:            "default",
			Content:          "Add additional working directories",
			Description:      strPtr("Add additional working directories"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: false,
		},
		{
			ID:               "default-init",
			CommandType:      CommandTypeClaude,
			Name:             "init",
			FullCommand:      "/init",
			Scope:            "default",
			Content:          "Initialize project with Memory guide",
			Description:      strPtr("Initialize project with Memory guide"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: false,
		},
		{
			ID:               "default-compact",
			CommandType:      CommandTypeClaude,
			Name:             "compact",
			FullCommand:      "/compact",
			Scope:            "default",
			Content:          "Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]",
			Description:      strPtr("Clear conversation history but keep a summary in context"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: true,
		},
		{
			ID:               "default-review",
			CommandType:      CommandTypeClaude,
			Name:             "review",
			FullCommand:      "/review",
			Scope:            "default",
			Content:          "Request code review",
			Description:      strPtr("Request code review"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: false,
		},
		{
			ID:               "default-clear",
			CommandType:      CommandTypeClaude,
			Name:             "clear",
			FullCommand:      "/clear",
			Scope:            "default",
			Content:          "Clear conversation history and start fresh",
			Description:      strPtr("Clear all messages and reset the session"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: false,
		},
		// Codex default commands
		{
			ID:               "default-clear-codex",
			CommandType:      CommandTypeCodex,
			Name:             "clear",
			FullCommand:      "/clear",
			Scope:            "default",
			Content:          "Clear conversation history and start fresh",
			Description:      strPtr("Clear all messages and reset the session"),
			AllowedTools:     []string{},
			HasBashCommands:  false,
			HasFileRefs:      false,
			AcceptsArguments: false,
		},
	}
	return commands
}

// loadCommandsFromDir loads all markdown commands from a directory
func loadCommandsFromDir(dir string, scope string, cmdType CommandType) ([]SlashCommand, error) {
	var commands []SlashCommand

	// Check if directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return commands, nil
	}

	// Find all markdown files recursively
	mdFiles, err := findMarkdownFiles(dir)
	if err != nil {
		return nil, err
	}

	for _, filePath := range mdFiles {
		cmd, err := loadCommandFromFile(filePath, dir, scope, cmdType)
		if err != nil {
			continue // Skip files we can't load
		}
		commands = append(commands, cmd)
	}

	return commands, nil
}

// findMarkdownFiles recursively finds all .md files in a directory
func findMarkdownFiles(dir string) ([]string, error) {
	var files []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip hidden files and directories
		if strings.HasPrefix(info.Name(), ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Collect .md files
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
			files = append(files, path)
		}

		return nil
	})

	return files, err
}

// loadCommandFromFile loads a single command from a markdown file
func loadCommandFromFile(filePath, baseDir, scope string, cmdType CommandType) (SlashCommand, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return SlashCommand{}, err
	}

	// Parse frontmatter
	frontmatter, body := parseMarkdownFrontmatter(string(content))

	// Extract command name and namespace from file path
	name, namespace := extractCommandInfo(filePath, baseDir)

	// Build full command
	var fullCommand string
	if namespace != nil {
		fullCommand = fmt.Sprintf("/%s:%s", *namespace, name)
	} else {
		fullCommand = fmt.Sprintf("/%s", name)
	}

	// Generate unique ID
	cmdTypeStr := string(cmdType)
	id := fmt.Sprintf("%s-%s-%s", cmdTypeStr, scope, strings.ReplaceAll(filePath, "/", "-"))

	// Check for special content
	hasBash := strings.Contains(body, "!`")
	hasFileRefs := strings.Contains(body, "@")
	acceptsArgs := strings.Contains(body, "$ARGUMENTS")

	cmd := SlashCommand{
		ID:               id,
		CommandType:      cmdType,
		Name:             name,
		FullCommand:      fullCommand,
		Scope:            scope,
		Namespace:        namespace,
		FilePath:         filePath,
		Content:          body,
		AllowedTools:     frontmatter.AllowedTools,
		HasBashCommands:  hasBash,
		HasFileRefs:      hasFileRefs,
		AcceptsArguments: acceptsArgs,
	}

	if frontmatter.Description != "" {
		cmd.Description = &frontmatter.Description
	}
	if frontmatter.ArgumentHint != "" {
		cmd.ArgumentHint = &frontmatter.ArgumentHint
	}

	return cmd, nil
}

// parseMarkdownFrontmatter parses YAML frontmatter from markdown content
func parseMarkdownFrontmatter(content string) (CommandFrontmatter, string) {
	lines := strings.Split(content, "\n")

	if len(lines) == 0 || lines[0] != "---" {
		return CommandFrontmatter{}, content
	}

	// Find the end of frontmatter
	var frontmatterEnd int
	for i := 1; i < len(lines); i++ {
		if lines[i] == "---" {
			frontmatterEnd = i
			break
		}
	}

	if frontmatterEnd == 0 {
		return CommandFrontmatter{}, content
	}

	// Extract and parse frontmatter
	frontmatterContent := strings.Join(lines[1:frontmatterEnd], "\n")
	bodyContent := strings.Join(lines[frontmatterEnd+1:], "\n")

	var fm CommandFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatterContent), &fm); err != nil {
		return CommandFrontmatter{}, content
	}

	return fm, bodyContent
}

// extractCommandInfo extracts command name and namespace from file path
func extractCommandInfo(filePath, baseDir string) (string, *string) {
	relPath, err := filepath.Rel(baseDir, filePath)
	if err != nil {
		return filepath.Base(filePath), nil
	}

	// Remove .md extension
	relPath = strings.TrimSuffix(relPath, ".md")

	// Split into components
	components := strings.Split(relPath, string(filepath.Separator))

	if len(components) == 1 {
		return components[0], nil
	}

	// Last component is the name, rest is namespace
	name := components[len(components)-1]
	namespace := strings.Join(components[:len(components)-1], ":")
	return name, &namespace
}

// loadPluginCommands loads commands from all installed plugins
func loadPluginCommands(homeDir string) []SlashCommand {
	var commands []SlashCommand

	pluginsDir := filepath.Join(homeDir, ".claude", "plugins")
	installedFile := filepath.Join(pluginsDir, "installed_plugins.json")

	// Check if installed_plugins.json exists
	if _, err := os.Stat(installedFile); os.IsNotExist(err) {
		return commands
	}

	// Read and parse installed_plugins.json
	content, err := os.ReadFile(installedFile)
	if err != nil {
		return commands
	}

	var installed InstalledPluginsFile
	if err := json.Unmarshal(content, &installed); err != nil {
		return commands
	}

	// Load commands from each plugin
	for pluginID, entries := range installed.Plugins {
		if len(entries) == 0 {
			continue
		}

		entry := entries[0] // Use first entry
		pluginPath := entry.InstallPath

		// Parse plugin name from ID (e.g., "superpowers@marketplace" -> "superpowers")
		pluginName := pluginID
		if atPos := strings.Index(pluginID, "@"); atPos != -1 {
			pluginName = pluginID[:atPos]
		}

		// Check both commands/ and .claude/commands/ directories
		commandDirs := []string{
			filepath.Join(pluginPath, "commands"),
			filepath.Join(pluginPath, ".claude", "commands"),
		}

		for _, commandDir := range commandDirs {
			if _, err := os.Stat(commandDir); os.IsNotExist(err) {
				continue
			}

			mdFiles, err := findMarkdownFiles(commandDir)
			if err != nil {
				continue
			}

			for _, filePath := range mdFiles {
				cmd, err := loadPluginCommandFromFile(filePath, commandDir, pluginID, pluginName)
				if err != nil {
					continue
				}
				commands = append(commands, cmd)
			}
		}
	}

	return commands
}

// loadPluginCommandFromFile loads a single command from a plugin markdown file
func loadPluginCommandFromFile(filePath, baseDir, pluginID, pluginName string) (SlashCommand, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return SlashCommand{}, err
	}

	// Parse frontmatter
	frontmatter, body := parseMarkdownFrontmatter(string(content))

	// Extract command name and namespace from file path
	name, namespace := extractCommandInfo(filePath, baseDir)

	// Build full command with plugin prefix: /plugin-name:command-name
	var fullCommand string
	if namespace != nil {
		fullCommand = fmt.Sprintf("/%s:%s:%s", pluginName, *namespace, name)
	} else {
		fullCommand = fmt.Sprintf("/%s:%s", pluginName, name)
	}

	// Generate unique ID
	id := fmt.Sprintf("plugin-%s-%s", strings.ReplaceAll(strings.ReplaceAll(pluginID, "@", "-"), "/", "-"), name)

	// Check for special content
	hasBash := strings.Contains(body, "!`")
	hasFileRefs := strings.Contains(body, "@")
	acceptsArgs := strings.Contains(body, "$ARGUMENTS")

	cmd := SlashCommand{
		ID:               id,
		CommandType:      CommandTypeClaude,
		Name:             name,
		FullCommand:      fullCommand,
		Scope:            "plugin",
		Namespace:        namespace,
		FilePath:         filePath,
		Content:          body,
		AllowedTools:     frontmatter.AllowedTools,
		HasBashCommands:  hasBash,
		HasFileRefs:      hasFileRefs,
		AcceptsArguments: acceptsArgs,
		PluginID:         &pluginID,
		PluginName:       &pluginName,
	}

	if frontmatter.Description != "" {
		cmd.Description = &frontmatter.Description
	}
	if frontmatter.ArgumentHint != "" {
		cmd.ArgumentHint = &frontmatter.ArgumentHint
	}

	return cmd, nil
}

// Helper function to create string pointer
func strPtr(s string) *string {
	return &s
}

// GetSlashCommand retrieves a specific slash command by name
// It first checks project-level commands, then falls back to global commands
func GetSlashCommand(name, projectPath string) (*SlashCommand, error) {
	commands, err := ListSlashCommands(projectPath)
	if err != nil {
		return nil, err
	}

	for _, cmd := range commands {
		if cmd.Name == name || cmd.FullCommand == "/"+name {
			return &cmd, nil
		}
	}

	return nil, fmt.Errorf("command not found: %s", name)
}

// SaveSlashCommand saves a slash command to the appropriate location
// scope should be "user" or "project"
func SaveSlashCommand(name, content, scope, projectPath string) error {
	if name == "" {
		return fmt.Errorf("command name cannot be empty")
	}

	var dir string

	switch scope {
	case "user", "global":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		dir = filepath.Join(homeDir, ".claude", "commands")

	case "project":
		if projectPath == "" {
			return fmt.Errorf("project path is required for project-level commands")
		}
		dir = filepath.Join(projectPath, ".claude", "commands")

	default:
		return fmt.Errorf("invalid scope: %s (must be 'user' or 'project')", scope)
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create commands directory: %w", err)
	}

	// Write command file
	filePath := filepath.Join(dir, name+".md")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write command file: %w", err)
	}

	return nil
}

// DeleteSlashCommand deletes a slash command
func DeleteSlashCommand(name, scope, projectPath string) error {
	if name == "" {
		return fmt.Errorf("command name cannot be empty")
	}

	var filePath string

	switch scope {
	case "user", "global":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		filePath = filepath.Join(homeDir, ".claude", "commands", name+".md")

	case "project":
		if projectPath == "" {
			return fmt.Errorf("project path is required for project-level commands")
		}
		filePath = filepath.Join(projectPath, ".claude", "commands", name+".md")

	default:
		return fmt.Errorf("invalid scope: %s (must be 'user' or 'project')", scope)
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("command not found: %s", name)
	}

	// Delete the file
	if err := os.Remove(filePath); err != nil {
		return fmt.Errorf("failed to delete command file: %w", err)
	}

	return nil
}
