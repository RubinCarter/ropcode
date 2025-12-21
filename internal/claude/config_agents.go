package claude

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ClaudeAgent represents a Claude Config Agent from .md files
type ClaudeAgent struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Tools        string `json:"tools,omitempty"`
	Color        string `json:"color,omitempty"`
	Model        string `json:"model,omitempty"`
	SystemPrompt string `json:"system_prompt"`
	Scope        string `json:"scope"` // "user" or "project"
	FilePath     string `json:"file_path"`
}

// ListClaudeConfigAgents lists all Claude config agents (user + project level)
// User agents are located in ~/.claude/agents/*.md
// Project agents are located in <project>/.claude/agents/*.md
func ListClaudeConfigAgents(projectPath string) ([]ClaudeAgent, error) {
	var agents []ClaudeAgent

	// Get home directory for user agents
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	// List user agents from ~/.claude/agents/
	userAgentsDir := filepath.Join(homeDir, ".claude", "agents")
	userAgents, err := listAgentsInDir(userAgentsDir, "user")
	if err == nil {
		agents = append(agents, userAgents...)
	}

	// List project agents from <project>/.claude/agents/ if projectPath is provided
	if projectPath != "" {
		projectAgentsDir := filepath.Join(projectPath, ".claude", "agents")
		projectAgents, err := listAgentsInDir(projectAgentsDir, "project")
		if err == nil {
			agents = append(agents, projectAgents...)
		}
	}

	return agents, nil
}

// listAgentsInDir lists all .md files in a directory as ClaudeAgent
func listAgentsInDir(dir string, scope string) ([]ClaudeAgent, error) {
	var agents []ClaudeAgent

	// Check if directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return agents, nil // Return empty list if directory doesn't exist
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory %s: %w", dir, err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), ".md")
		path := filepath.Join(dir, entry.Name())

		// Read and parse agent file
		agent, err := parseAgentFile(path, name, scope)
		if err != nil {
			continue // Skip files we can't parse
		}

		agents = append(agents, *agent)
	}

	return agents, nil
}

// parseAgentFile parses an agent .md file and extracts frontmatter + content
func parseAgentFile(filePath, name, scope string) (*ClaudeAgent, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	agent := &ClaudeAgent{
		Name:     name,
		Scope:    scope,
		FilePath: filePath,
	}

	// Parse frontmatter and content
	lines := strings.Split(string(content), "\n")
	inFrontmatter := false
	frontmatterEnd := 0

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Detect frontmatter start (---)
		if i == 0 && trimmed == "---" {
			inFrontmatter = true
			continue
		}

		// Detect frontmatter end (---)
		if inFrontmatter && trimmed == "---" {
			inFrontmatter = false
			frontmatterEnd = i + 1
			break
		}

		// Parse frontmatter fields
		if inFrontmatter && strings.Contains(trimmed, ":") {
			parts := strings.SplitN(trimmed, ":", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])

				switch key {
				case "description":
					agent.Description = value
				case "tools":
					agent.Tools = value
				case "color":
					agent.Color = value
				case "model":
					agent.Model = value
				}
			}
		}
	}

	// Extract system prompt (everything after frontmatter)
	if frontmatterEnd < len(lines) {
		agent.SystemPrompt = strings.TrimSpace(strings.Join(lines[frontmatterEnd:], "\n"))
	}

	return agent, nil
}

// GetClaudeAgent retrieves a specific Claude config agent by scope and name
func GetClaudeAgent(scope, name, projectPath string) (*ClaudeAgent, error) {
	if name == "" {
		return nil, fmt.Errorf("agent name cannot be empty")
	}

	var filePath string

	switch scope {
	case "user":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get home directory: %w", err)
		}
		filePath = filepath.Join(homeDir, ".claude", "agents", name+".md")

	case "project":
		if projectPath == "" {
			return nil, fmt.Errorf("project path is required for project-level agents")
		}
		filePath = filepath.Join(projectPath, ".claude", "agents", name+".md")

	default:
		return nil, fmt.Errorf("invalid scope: %s (must be 'user' or 'project')", scope)
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("agent not found: %s", name)
	}

	return parseAgentFile(filePath, name, scope)
}

// SaveClaudeAgent saves a Claude config agent to the appropriate location
func SaveClaudeAgent(agent *ClaudeAgent, projectPath string) error {
	if agent.Name == "" {
		return fmt.Errorf("agent name cannot be empty")
	}

	var dir string

	switch agent.Scope {
	case "user":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		dir = filepath.Join(homeDir, ".claude", "agents")

	case "project":
		if projectPath == "" {
			return fmt.Errorf("project path is required for project-level agents")
		}
		dir = filepath.Join(projectPath, ".claude", "agents")

	default:
		return fmt.Errorf("invalid scope: %s (must be 'user' or 'project')", agent.Scope)
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create agents directory: %w", err)
	}

	// Build file content with frontmatter
	var content strings.Builder
	content.WriteString("---\n")
	if agent.Description != "" {
		content.WriteString(fmt.Sprintf("description: %s\n", agent.Description))
	}
	if agent.Tools != "" {
		content.WriteString(fmt.Sprintf("tools: %s\n", agent.Tools))
	}
	if agent.Color != "" {
		content.WriteString(fmt.Sprintf("color: %s\n", agent.Color))
	}
	if agent.Model != "" {
		content.WriteString(fmt.Sprintf("model: %s\n", agent.Model))
	}
	content.WriteString("---\n\n")
	content.WriteString(agent.SystemPrompt)

	// Write agent file
	filePath := filepath.Join(dir, agent.Name+".md")
	if err := os.WriteFile(filePath, []byte(content.String()), 0644); err != nil {
		return fmt.Errorf("failed to write agent file: %w", err)
	}

	return nil
}

// DeleteClaudeAgent deletes a Claude config agent
func DeleteClaudeAgent(scope, name, projectPath string) error {
	if name == "" {
		return fmt.Errorf("agent name cannot be empty")
	}

	var filePath string

	switch scope {
	case "user":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		filePath = filepath.Join(homeDir, ".claude", "agents", name+".md")

	case "project":
		if projectPath == "" {
			return fmt.Errorf("project path is required for project-level agents")
		}
		filePath = filepath.Join(projectPath, ".claude", "agents", name+".md")

	default:
		return fmt.Errorf("invalid scope: %s (must be 'user' or 'project')", scope)
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("agent not found: %s", name)
	}

	// Delete the file
	if err := os.Remove(filePath); err != nil {
		return fmt.Errorf("failed to delete agent file: %w", err)
	}

	return nil
}
