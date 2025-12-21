// internal/agents/github.go
package agents

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"ropcode/internal/database"
)

// GitHubAgent represents an agent available on GitHub
type GitHubAgent struct {
	Name         string `json:"name" yaml:"name"`
	Icon         string `json:"icon" yaml:"icon"`
	SystemPrompt string `json:"system_prompt" yaml:"system_prompt"`
	DefaultTask  string `json:"default_task,omitempty" yaml:"default_task,omitempty"`
	Model        string `json:"model" yaml:"model"`
	Description  string `json:"description,omitempty" yaml:"description,omitempty"`
	Author       string `json:"author,omitempty" yaml:"author,omitempty"`
	URL          string `json:"url,omitempty" yaml:"url,omitempty"`
}

// GitHubAgentList represents a list of GitHub agents
type GitHubAgentList struct {
	Agents []GitHubAgent `json:"agents" yaml:"agents"`
}

// httpClient is the HTTP client for making requests
var httpClient = &http.Client{
	Timeout: 30 * time.Second,
}

// ConvertToRawURL converts a GitHub URL to raw content URL
func ConvertToRawURL(url string) string {
	// Convert https://github.com/user/repo/blob/main/file -> https://raw.githubusercontent.com/user/repo/main/file
	if strings.Contains(url, "github.com") && strings.Contains(url, "/blob/") {
		url = strings.Replace(url, "github.com", "raw.githubusercontent.com", 1)
		url = strings.Replace(url, "/blob/", "/", 1)
	}
	return url
}

// FetchURL fetches content from a URL
func FetchURL(url string) ([]byte, error) {
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP error: %d %s", resp.StatusCode, resp.Status)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	return data, nil
}

// ParseAgentConfig parses agent configuration from JSON or YAML
func ParseAgentConfig(data []byte, format string) (*GitHubAgent, error) {
	var agent GitHubAgent

	switch strings.ToLower(format) {
	case "json":
		if err := json.Unmarshal(data, &agent); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case "yaml", "yml":
		if err := yaml.Unmarshal(data, &agent); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	default:
		// Try JSON first, then YAML
		if err := json.Unmarshal(data, &agent); err != nil {
			if err := yaml.Unmarshal(data, &agent); err != nil {
				return nil, fmt.Errorf("failed to parse as JSON or YAML")
			}
		}
	}

	return &agent, nil
}

// FetchGitHubAgentContent fetches an agent configuration from a GitHub URL
func FetchGitHubAgentContent(url string) (*GitHubAgent, error) {
	// Convert to raw URL if needed
	rawURL := ConvertToRawURL(url)

	// Fetch content
	data, err := FetchURL(rawURL)
	if err != nil {
		return nil, err
	}

	// Determine format from URL
	format := "json"
	if strings.HasSuffix(strings.ToLower(url), ".yaml") || strings.HasSuffix(strings.ToLower(url), ".yml") {
		format = "yaml"
	}

	// Parse agent config
	agent, err := ParseAgentConfig(data, format)
	if err != nil {
		return nil, err
	}

	// Store the source URL
	agent.URL = url

	return agent, nil
}

// FetchGitHubAgentList fetches a list of agents from a GitHub URL
func FetchGitHubAgentList(url string) ([]GitHubAgent, error) {
	// Convert to raw URL if needed
	rawURL := ConvertToRawURL(url)

	// Fetch content
	data, err := FetchURL(rawURL)
	if err != nil {
		return nil, err
	}

	// Determine format from URL
	format := "json"
	if strings.HasSuffix(strings.ToLower(url), ".yaml") || strings.HasSuffix(strings.ToLower(url), ".yml") {
		format = "yaml"
	}

	// Parse agent list
	var agentList GitHubAgentList
	switch strings.ToLower(format) {
	case "json":
		if err := json.Unmarshal(data, &agentList); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case "yaml", "yml":
		if err := yaml.Unmarshal(data, &agentList); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	}

	return agentList.Agents, nil
}

// ConvertToDBAgent converts a GitHubAgent to a database.Agent
func ConvertToDBAgent(ghAgent *GitHubAgent) *database.Agent {
	return &database.Agent{
		Name:         ghAgent.Name,
		Icon:         ghAgent.Icon,
		SystemPrompt: ghAgent.SystemPrompt,
		DefaultTask:  ghAgent.DefaultTask,
		Model:        ghAgent.Model,
	}
}

// ImportGitHubAgent imports an agent from GitHub and saves to database
func ImportGitHubAgent(url string, db *database.Database) (*database.Agent, error) {
	// Fetch agent from GitHub
	ghAgent, err := FetchGitHubAgentContent(url)
	if err != nil {
		return nil, err
	}

	// Convert to database agent
	dbAgent := ConvertToDBAgent(ghAgent)

	// Create agent in database
	id, err := db.CreateAgent(dbAgent)
	if err != nil {
		return nil, fmt.Errorf("failed to save agent: %w", err)
	}
	dbAgent.ID = id

	return dbAgent, nil
}

// PredefinedAgents returns a list of predefined agent templates
func PredefinedAgents() []GitHubAgent {
	return []GitHubAgent{
		{
			Name:         "Code Reviewer",
			Icon:         "🔍",
			SystemPrompt: "You are an expert code reviewer. Review code for best practices, potential bugs, security issues, and performance optimizations. Provide constructive feedback with specific suggestions for improvement.",
			DefaultTask:  "Review the code in this project",
			Model:        "sonnet",
			Description:  "Expert code reviewer for quality and best practices",
		},
		{
			Name:         "Bug Fixer",
			Icon:         "🐛",
			SystemPrompt: "You are a debugging expert. Analyze error messages, stack traces, and code to identify root causes of bugs. Provide clear explanations and reliable fixes.",
			DefaultTask:  "Find and fix bugs",
			Model:        "sonnet",
			Description:  "Debugging expert for finding and fixing bugs",
		},
		{
			Name:         "Documentation Writer",
			Icon:         "📝",
			SystemPrompt: "You are a technical documentation specialist. Write clear, comprehensive documentation including API docs, README files, and code comments. Focus on clarity and completeness.",
			DefaultTask:  "Write documentation for this project",
			Model:        "sonnet",
			Description:  "Technical writer for creating documentation",
		},
		{
			Name:         "Test Generator",
			Icon:         "🧪",
			SystemPrompt: "You are a testing expert. Generate comprehensive test cases including unit tests, integration tests, and edge cases. Follow testing best practices and ensure good coverage.",
			DefaultTask:  "Generate tests for this code",
			Model:        "sonnet",
			Description:  "Testing expert for generating test cases",
		},
		{
			Name:         "Performance Optimizer",
			Icon:         "⚡",
			SystemPrompt: "You are a performance optimization expert. Analyze code for performance bottlenecks, memory usage, and algorithmic efficiency. Suggest concrete optimizations with benchmarks.",
			DefaultTask:  "Optimize code performance",
			Model:        "opus",
			Description:  "Performance expert for optimization tasks",
		},
		{
			Name:         "Security Auditor",
			Icon:         "🔒",
			SystemPrompt: "You are a security expert. Audit code for security vulnerabilities, including SQL injection, XSS, authentication issues, and data exposure. Provide remediation steps.",
			DefaultTask:  "Audit code for security issues",
			Model:        "opus",
			Description:  "Security expert for vulnerability audits",
		},
	}
}
