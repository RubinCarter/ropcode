// internal/github/agents.go
package github

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GitHubAgentsList represents the default GitHub agents repository
const (
	// DefaultAgentsURL points to the GitHub API endpoint for listing cc_agents files
	DefaultAgentsURL = "https://api.github.com/repos/getAsterisk/opcode/contents/cc_agents"
	// RawContentBaseURL is the base URL for raw file content from the correct repository
	RawContentBaseURL = "https://raw.githubusercontent.com/getAsterisk/opcode/main"
)

// GitHubFile represents a file entry from GitHub API contents response
type GitHubFile struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	SHA         string `json:"sha"`
	Size        int    `json:"size"`
	URL         string `json:"url"`
	HTMLURL     string `json:"html_url"`
	GitURL      string `json:"git_url"`
	DownloadURL string `json:"download_url"`
	Type        string `json:"type"`
}

// AgentMetadata represents an agent's metadata from GitHub (kept for backward compatibility)
type AgentMetadata struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	DownloadURL string `json:"download_url"`
	Size        int    `json:"size"`
	SHA         string `json:"sha"`
}

// AgentContent represents the full content of an agent from GitHub
type AgentContent struct {
	Name         string `json:"name"`
	Icon         string `json:"icon"`
	Model        string `json:"model"`
	SystemPrompt string `json:"system_prompt"`
	DefaultTask  string `json:"default_task,omitempty"`
}

// FetchAgents fetches the list of available agents from GitHub API
func FetchAgents(url string) ([]AgentMetadata, error) {
	if url == "" {
		url = DefaultAgentsURL
	}

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set User-Agent header required by GitHub API
	req.Header.Set("User-Agent", "Ropcode-App")
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agents list: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch agents list: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var files []GitHubFile
	if err := json.Unmarshal(body, &files); err != nil {
		return nil, fmt.Errorf("failed to parse agents list: %w", err)
	}

	// Filter to only include .opcode.json files (the standard format on GitHub)
	var agents []AgentMetadata
	for _, file := range files {
		if file.Type == "file" && strings.HasSuffix(file.Name, ".opcode.json") {
			// Build the download URL ourselves to ensure it points to the correct repository
			// GitHub API may return download_url pointing to a fork repository
			downloadURL := fmt.Sprintf("%s/%s", RawContentBaseURL, file.Path)
			agents = append(agents, AgentMetadata{
				Name:        file.Name,
				Path:        file.Path,
				DownloadURL: downloadURL,
				Size:        file.Size,
				SHA:         file.SHA,
			})
		}
	}

	return agents, nil
}

// AgentExportFile represents the exported agent file format (.ropcode.json)
type AgentExportFile struct {
	Agent      AgentContent `json:"agent"`
	ExportedAt string       `json:"exported_at"`
	Version    int          `json:"version"`
}

// FetchAgentExportFile fetches and parses a full agent export file from a GitHub URL
func FetchAgentExportFile(url string) (*AgentExportFile, error) {
	if url == "" {
		return nil, fmt.Errorf("agent URL is required")
	}

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agent content: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch agent content: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	// Parse the exported agent file format
	var exportFile AgentExportFile
	if err := json.Unmarshal(body, &exportFile); err != nil {
		return nil, fmt.Errorf("failed to parse agent content: %w", err)
	}

	// Validate required fields
	if err := validateAgentContent(&exportFile.Agent); err != nil {
		return nil, err
	}

	return &exportFile, nil
}

// FetchAgentContent fetches and parses a specific agent's content from a GitHub URL
func FetchAgentContent(url string) (*AgentContent, error) {
	exportFile, err := FetchAgentExportFile(url)
	if err != nil {
		return nil, err
	}
	return &exportFile.Agent, nil
}

// validateAgentContent validates that required fields are present
func validateAgentContent(agent *AgentContent) error {
	if agent.Name == "" {
		return fmt.Errorf("agent name is required")
	}
	if agent.SystemPrompt == "" {
		return fmt.Errorf("agent system_prompt is required")
	}

	// Set defaults if not provided
	if agent.Icon == "" {
		agent.Icon = "🤖"
	}
	if agent.Model == "" {
		agent.Model = "sonnet"
	}

	// Normalize model name
	agent.Model = normalizeModelName(agent.Model)

	return nil
}

// normalizeModelName normalizes model names to standard values
func normalizeModelName(model string) string {
	model = strings.ToLower(strings.TrimSpace(model))

	// Map common variations to standard names
	switch model {
	case "sonnet", "claude-sonnet", "claude-3-sonnet", "claude-3.5-sonnet", "claude-sonnet-3.5":
		return "sonnet"
	case "opus", "claude-opus", "claude-3-opus":
		return "opus"
	case "haiku", "claude-haiku", "claude-3-haiku":
		return "haiku"
	default:
		// If it's already a valid model name, return as is
		// Otherwise default to sonnet
		if model != "" {
			return model
		}
		return "sonnet"
	}
}

// ParseAgentFromJSON parses agent content from JSON string (exported .ropcode.json format)
func ParseAgentFromJSON(jsonContent string) (*AgentContent, error) {
	var exportFile AgentExportFile
	if err := json.Unmarshal([]byte(jsonContent), &exportFile); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %w", err)
	}

	if err := validateAgentContent(&exportFile.Agent); err != nil {
		return nil, err
	}

	return &exportFile.Agent, nil
}

// ParseAgentFromURL fetches and parses an agent from a raw GitHub URL
func ParseAgentFromURL(url string) (*AgentContent, error) {
	// Support both raw.githubusercontent.com and github.com URLs
	url = normalizeGitHubURL(url)
	return FetchAgentContent(url)
}

// normalizeGitHubURL converts GitHub URLs to raw content URLs
func normalizeGitHubURL(url string) string {
	// If already a raw URL, return as is
	if strings.Contains(url, "raw.githubusercontent.com") {
		return url
	}

	// Convert github.com/user/repo/blob/branch/path to raw.githubusercontent.com/user/repo/branch/path
	url = strings.Replace(url, "github.com", "raw.githubusercontent.com", 1)
	url = strings.Replace(url, "/blob/", "/", 1)

	return url
}
