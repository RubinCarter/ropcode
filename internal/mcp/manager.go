package mcp

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// MCPServerConfig represents an individual MCP server configuration
type MCPServerConfig struct {
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	URL     string            `json:"url,omitempty"`
}

// MCPServerStatus represents the runtime status of an MCP server
type MCPServerStatus struct {
	Running     bool   `json:"running"`
	Error       string `json:"error,omitempty"`
	LastChecked int64  `json:"last_checked,omitempty"`
}

// MCPServer represents a complete MCP server with config and status
type MCPServer struct {
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	URL       string            `json:"url,omitempty"`
	Scope     string            `json:"scope"`
	IsActive  bool              `json:"is_active"`
	Status    MCPServerStatus   `json:"status"`
}

// Manager handles MCP server configuration management
type Manager struct {
	settingsPath string
	claudeBinary string
	mu           sync.RWMutex
}

// NewManager creates a new MCP manager
func NewManager(claudeDir string) *Manager {
	return &Manager{
		settingsPath: filepath.Join(claudeDir, "settings.json"),
		claudeBinary: "claude", // Default to "claude" in PATH
	}
}

// SetClaudeBinary sets the Claude binary path
func (m *Manager) SetClaudeBinary(path string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.claudeBinary = path
}

// executeClaudeMcpCommand executes a claude mcp command and returns the output
func (m *Manager) executeClaudeMcpCommand(args []string) (string, error) {
	// Dynamically find claude binary (critical for .app packages with limited PATH)
	claudePath := m.findClaudeBinary()
	if claudePath == "" {
		return "", fmt.Errorf("claude binary not found in PATH or common locations")
	}

	cmdArgs := append([]string{"mcp"}, args...)
	cmd := exec.Command(claudePath, cmdArgs...)

	// Set environment to avoid interactive prompts
	cmd.Env = append(os.Environ(), "CLAUDE_NO_COLOR=1")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("claude mcp command failed: %w, output: %s", err, string(output))
	}

	return string(output), nil
}

// findClaudeBinary dynamically finds the claude binary in common locations
// This is critical for .app packages where PATH is limited
func (m *Manager) findClaudeBinary() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// If explicitly set, use that
	if m.claudeBinary != "" && m.claudeBinary != "claude" {
		return m.claudeBinary
	}

	// Check common installation locations (independent of PATH)
	homeDir, _ := os.UserHomeDir()
	candidatePaths := []string{
		"/opt/homebrew/bin/claude",                               // Apple Silicon Homebrew
		"/usr/local/bin/claude",                                   // Intel Mac Homebrew
		filepath.Join(homeDir, ".nvm/versions/node/*/bin/claude"), // NVM (will glob)
		filepath.Join(homeDir, ".npm/bin/claude"),
		filepath.Join(homeDir, ".npm-global/bin/claude"),
		filepath.Join(homeDir, ".local/bin/claude"),
	}

	for _, path := range candidatePaths {
		// Handle glob patterns for NVM
		if strings.Contains(path, "*") {
			matches, _ := filepath.Glob(path)
			for _, match := range matches {
				if _, err := os.Stat(match); err == nil {
					log.Printf("[MCP] Found claude at: %s", match)
					return match
				}
			}
		} else {
			if _, err := os.Stat(path); err == nil {
				log.Printf("[MCP] Found claude at: %s", path)
				return path
			}
		}
	}

	// Fallback: try PATH (works in dev mode)
	if path, err := exec.LookPath("claude"); err == nil {
		log.Printf("[MCP] Found claude in PATH: %s", path)
		return path
	}

	log.Printf("[MCP] WARNING: claude binary not found in any location")
	return ""
}

// loadSettings reads the settings.json file
func (m *Manager) loadSettings() (map[string]interface{}, error) {
	data, err := os.ReadFile(m.settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]interface{}), nil
		}
		return nil, err
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}

	return settings, nil
}

// saveSettings writes the settings.json file
func (m *Manager) saveSettings(settings map[string]interface{}) error {
	dir := filepath.Dir(m.settingsPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.settingsPath, data, 0644)
}

// ListMcpServers returns all configured MCP servers using `claude mcp list`
func (m *Manager) ListMcpServers() ([]*MCPServer, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	log.Printf("[MCP] Listing MCP servers using claude mcp list")

	output, err := m.executeClaudeMcpCommand([]string{"list"})
	if err != nil {
		log.Printf("[MCP] Failed to execute claude mcp list: %v", err)
		// Fallback to reading from settings.json
		return m.listMcpServersFromSettings()
	}

	log.Printf("[MCP] Raw output from 'claude mcp list': %s", output)
	trimmed := strings.TrimSpace(output)

	// Check if no servers are configured
	if strings.Contains(trimmed, "No MCP servers configured") || trimmed == "" {
		log.Printf("[MCP] No servers found")
		return []*MCPServer{}, nil
	}

	// Parse the text output from claude mcp list
	// Format example:
	// Name: server-name
	// Type: stdio
	// Command: /path/to/command arg1 arg2
	// Scope: user
	// ---
	servers := m.parseMcpListOutput(trimmed)
	log.Printf("[MCP] Parsed %d servers from output", len(servers))

	return servers, nil
}

// parseMcpListOutput parses the text output from `claude mcp list`
// The actual output format is:
// Checking MCP server health...
//
// server-name: command args - ✓ Connected
// server-name2: command2 args2 - ✗ Error message
func (m *Manager) parseMcpListOutput(output string) []*MCPServer {
	var servers []*MCPServer

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Skip header lines
		if strings.HasPrefix(line, "Checking MCP server") {
			continue
		}

		// Try to parse "server-name: command args - status" format
		server := m.parseServerLine(line)
		if server != nil {
			servers = append(servers, server)
		}
	}

	return servers
}

// parseServerLine parses a single server line in format "name: command args - status"
func (m *Manager) parseServerLine(line string) *MCPServer {
	// Format: "server-name: command args - ✓ Connected" or "server-name: command args - ✗ Error"

	// First, split by " - " to separate command from status
	statusIdx := strings.LastIndex(line, " - ")
	var statusPart string
	var mainPart string

	if statusIdx > 0 {
		mainPart = line[:statusIdx]
		statusPart = strings.TrimSpace(line[statusIdx+3:])
	} else {
		mainPart = line
	}

	// Now split mainPart by first ":" to get name and command
	colonIdx := strings.Index(mainPart, ":")
	if colonIdx <= 0 {
		return nil
	}

	name := strings.TrimSpace(mainPart[:colonIdx])
	commandPart := strings.TrimSpace(mainPart[colonIdx+1:])

	if name == "" || commandPart == "" {
		return nil
	}

	// Parse command and args
	cmdParts := parseCommandLine(commandPart)
	if len(cmdParts) == 0 {
		return nil
	}

	server := &MCPServer{
		Name:      name,
		Transport: "stdio",
		Command:   cmdParts[0],
		Env:       make(map[string]string), // Initialize empty env map to prevent frontend errors
		Scope:     "user",
		IsActive:  true,
		Status: MCPServerStatus{
			Running: false,
		},
	}

	if len(cmdParts) > 1 {
		server.Args = cmdParts[1:]
	}

	// Parse status
	if strings.Contains(statusPart, "✓") || strings.Contains(statusPart, "Connected") {
		server.Status.Running = true
	} else if strings.Contains(statusPart, "✗") || strings.Contains(statusPart, "Error") {
		server.Status.Running = false
		server.Status.Error = statusPart
	}

	log.Printf("[MCP] Parsed server: name=%s, command=%s, args=%v, running=%v",
		server.Name, server.Command, server.Args, server.Status.Running)

	return server
}

// parseCommandLine parses a command line string into command and args
func parseCommandLine(cmdLine string) []string {
	// Simple parsing - split by spaces, respecting quotes
	var parts []string
	var current strings.Builder
	inQuote := false
	quoteChar := rune(0)

	for _, ch := range cmdLine {
		switch {
		case ch == '"' || ch == '\'':
			if inQuote && ch == quoteChar {
				inQuote = false
				quoteChar = 0
			} else if !inQuote {
				inQuote = true
				quoteChar = ch
			} else {
				current.WriteRune(ch)
			}
		case ch == ' ' && !inQuote:
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(ch)
		}
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	return parts
}

// parseEnvString parses environment variables from a string like "KEY1=value1, KEY2=value2"
func parseEnvString(envStr string) map[string]string {
	env := make(map[string]string)
	// Match KEY=value patterns
	re := regexp.MustCompile(`(\w+)=([^,\s]+)`)
	matches := re.FindAllStringSubmatch(envStr, -1)
	for _, match := range matches {
		if len(match) == 3 {
			env[match[1]] = match[2]
		}
	}
	return env
}

// listMcpServersFromSettings is a fallback that reads from settings.json
func (m *Manager) listMcpServersFromSettings() ([]*MCPServer, error) {
	log.Printf("[MCP] Falling back to reading from settings.json")

	settings, err := m.loadSettings()
	if err != nil {
		return nil, err
	}

	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if !ok {
		// No mcpServers field, return empty list
		return []*MCPServer{}, nil
	}

	var servers []*MCPServer
	for name, configData := range mcpServers {
		configMap, ok := configData.(map[string]interface{})
		if !ok {
			continue
		}

		server := &MCPServer{
			Name:     name,
			Scope:    "user",
			IsActive: true,
		}

		// Parse command
		if cmd, ok := configMap["command"].(string); ok {
			server.Command = cmd
			server.Transport = "stdio"
		}

		// Parse args
		if argsData, ok := configMap["args"].([]interface{}); ok {
			args := make([]string, 0, len(argsData))
			for _, arg := range argsData {
				if argStr, ok := arg.(string); ok {
					args = append(args, argStr)
				}
			}
			server.Args = args
		}

		// Parse env
		if envData, ok := configMap["env"].(map[string]interface{}); ok {
			env := make(map[string]string)
			for key, value := range envData {
				if valStr, ok := value.(string); ok {
					env[key] = valStr
				}
			}
			server.Env = env
		}

		// Parse URL (for SSE transport)
		if url, ok := configMap["url"].(string); ok {
			server.URL = url
			server.Transport = "sse"
		}

		// Initialize status
		server.Status = MCPServerStatus{
			Running: false,
		}

		servers = append(servers, server)
	}

	return servers, nil
}

// GetMcpServer returns a specific MCP server configuration
func (m *Manager) GetMcpServer(name string) (*MCPServer, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	settings, err := m.loadSettings()
	if err != nil {
		return nil, err
	}

	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("server %s not found", name)
	}

	configData, ok := mcpServers[name].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("server %s not found", name)
	}

	server := &MCPServer{
		Name:     name,
		Scope:    "user",
		IsActive: true,
		Status: MCPServerStatus{
			Running: false,
		},
	}

	// Parse command
	if cmd, ok := configData["command"].(string); ok {
		server.Command = cmd
		server.Transport = "stdio"
	}

	// Parse args
	if argsData, ok := configData["args"].([]interface{}); ok {
		args := make([]string, 0, len(argsData))
		for _, arg := range argsData {
			if argStr, ok := arg.(string); ok {
				args = append(args, argStr)
			}
		}
		server.Args = args
	}

	// Parse env
	if envData, ok := configData["env"].(map[string]interface{}); ok {
		env := make(map[string]string)
		for key, value := range envData {
			if valStr, ok := value.(string); ok {
				env[key] = valStr
			}
		}
		server.Env = env
	}

	// Parse URL
	if url, ok := configData["url"].(string); ok {
		server.URL = url
		server.Transport = "sse"
	}

	return server, nil
}

// SaveMcpServer saves or updates an MCP server configuration
func (m *Manager) SaveMcpServer(name string, config *MCPServerConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	settings, err := m.loadSettings()
	if err != nil {
		return err
	}

	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if !ok {
		mcpServers = make(map[string]interface{})
		settings["mcpServers"] = mcpServers
	}

	// Build config map
	configMap := make(map[string]interface{})

	if config.Command != "" {
		configMap["command"] = config.Command
	}

	if len(config.Args) > 0 {
		configMap["args"] = config.Args
	}

	if len(config.Env) > 0 {
		configMap["env"] = config.Env
	}

	if config.URL != "" {
		configMap["url"] = config.URL
	}

	mcpServers[name] = configMap

	return m.saveSettings(settings)
}

// DeleteMcpServer removes an MCP server configuration
func (m *Manager) DeleteMcpServer(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	settings, err := m.loadSettings()
	if err != nil {
		return err
	}

	mcpServers, ok := settings["mcpServers"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("server %s not found", name)
	}

	if _, exists := mcpServers[name]; !exists {
		return fmt.Errorf("server %s not found", name)
	}

	delete(mcpServers, name)

	return m.saveSettings(settings)
}

// GetMcpServerStatus returns the runtime status of an MCP server
// Note: This is a placeholder implementation - actual status checking
// would require process management integration
func (m *Manager) GetMcpServerStatus(name string) (*MCPServerStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Verify the server exists
	_, err := m.GetMcpServer(name)
	if err != nil {
		return nil, err
	}

	// Return default status
	// In a full implementation, this would check if the process is actually running
	return &MCPServerStatus{
		Running: false,
	}, nil
}
