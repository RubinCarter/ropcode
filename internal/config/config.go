// internal/config/config.go
package config

import (
	"os"
	"path/filepath"
)

// Config holds all application configuration paths
type Config struct {
	HomeDir      string
	RopcodeDir   string
	ClaudeDir    string
	DatabasePath string
	LogDir       string
}

// Load creates a Config instance with resolved paths
func Load() (*Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	ropcodeDir := filepath.Join(home, ".ropcode")
	claudeDir := filepath.Join(home, ".claude")
	logDir := filepath.Join(ropcodeDir, "logs")

	// Ensure directories exist
	for _, dir := range []string{ropcodeDir, logDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}

	return &Config{
		HomeDir:      home,
		RopcodeDir:   ropcodeDir,
		ClaudeDir:    claudeDir,
		DatabasePath: filepath.Join(ropcodeDir, "agents.db"),
		LogDir:       logDir,
	}, nil
}

// GetProjectPath returns the path to a project's .claude directory
func (c *Config) GetProjectPath(projectPath string) string {
	return filepath.Join(projectPath, ".claude")
}

// GetSessionPath returns the path to a session's directory
func (c *Config) GetSessionPath(projectPath, sessionID string) string {
	return filepath.Join(c.GetProjectPath(projectPath), "sessions", sessionID)
}
