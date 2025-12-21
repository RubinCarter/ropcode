// internal/provider/claude.go
package provider

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ClaudeProvider implements the Provider interface for Claude Code
type ClaudeProvider struct {
	binaryPath string
}

// NewClaudeProvider creates a new Claude provider instance
func NewClaudeProvider(binaryPath string) *ClaudeProvider {
	return &ClaudeProvider{
		binaryPath: binaryPath,
	}
}

// ID returns the unique identifier for this provider
func (p *ClaudeProvider) ID() string {
	return "claude"
}

// Name returns the human-readable name of the provider
func (p *ClaudeProvider) Name() string {
	return "Claude Code"
}

// SupportedModels returns the list of models supported by Claude
func (p *ClaudeProvider) SupportedModels() []ModelInfo {
	return []ModelInfo{
		{
			ID:          "sonnet",
			Name:        "Claude 3.5 Sonnet",
			Description: "Most capable model for coding tasks",
		},
		{
			ID:          "opus",
			Name:        "Claude 3 Opus",
			Description: "Previous generation flagship model",
		},
		{
			ID:          "haiku",
			Name:        "Claude 3 Haiku",
			Description: "Fastest model for simple tasks",
		},
	}
}

// DiscoverInstallations attempts to find installed instances of Claude Code
func (p *ClaudeProvider) DiscoverInstallations() ([]Installation, error) {
	var installations []Installation
	seen := make(map[string]bool)

	// Check common locations
	locations := []string{
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
	}

	// Check PATH first
	if path, err := exec.LookPath("claude"); err == nil {
		locations = append([]string{path}, locations...)
	}

	// Check npm global installations
	if home, err := os.UserHomeDir(); err == nil {
		npmLocations := []string{
			filepath.Join(home, ".npm-global", "bin", "claude"),
			filepath.Join(home, ".npm", "bin", "claude"),
			filepath.Join(home, "node_modules", ".bin", "claude"),
		}
		locations = append(locations, npmLocations...)
	}

	// Check each location
	for _, loc := range locations {
		// Skip duplicates (resolve symlinks for comparison)
		resolved, err := filepath.EvalSymlinks(loc)
		if err != nil {
			resolved = loc
		}

		if seen[resolved] {
			continue
		}

		// Check if file exists and is executable
		if info, err := os.Stat(loc); err == nil {
			// Check if it's a file and executable
			if !info.IsDir() && (info.Mode()&0111) != 0 {
				seen[resolved] = true
				version := p.getVersion(loc)
				installations = append(installations, Installation{
					Path:    loc,
					Version: version,
					Source:  "discovered",
				})
			}
		}
	}

	return installations, nil
}

// getVersion attempts to get the version of a Claude binary
func (p *ClaudeProvider) getVersion(binaryPath string) string {
	cmd := exec.Command(binaryPath, "--version")
	output, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

// StartSession starts a new Claude Code session
func (p *ClaudeProvider) StartSession(ctx context.Context, config SessionConfig) error {
	binaryPath := p.binaryPath

	// If no binary path configured, try to discover one
	if binaryPath == "" {
		installations, err := p.DiscoverInstallations()
		if err != nil || len(installations) == 0 {
			return fmt.Errorf("claude binary not found: please install Claude Code CLI")
		}
		binaryPath = installations[0].Path
	}

	// Verify the binary exists
	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return fmt.Errorf("claude binary not found at path: %s", binaryPath)
	}

	// Build command arguments
	args := []string{
		"-p", config.Prompt,
		"--model", config.Model,
		"--output-format", "stream-json",
		"--verbose",
		"--dangerously-skip-permissions",
	}

	// Create the command
	cmd := exec.CommandContext(ctx, binaryPath, args...)
	cmd.Dir = config.ProjectPath

	// Set environment variables
	cmd.Env = os.Environ()

	// TODO: In a real implementation, we would:
	// 1. Capture stdout/stderr and stream to the frontend
	// 2. Store the cmd in a session manager for later termination
	// 3. Handle process lifecycle properly
	//
	// For now, we just start the process to satisfy the interface
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start claude session: %w", err)
	}

	// In production, we would store cmd.Process for later termination
	// and set up goroutines to handle stdout/stderr streaming

	return nil
}

// TerminateSession terminates an active Claude session
func (p *ClaudeProvider) TerminateSession(ctx context.Context, projectPath string) error {
	// TODO: In a real implementation, we would:
	// 1. Look up the running process for this projectPath
	// 2. Send graceful shutdown signal (SIGINT)
	// 3. Wait with timeout
	// 4. Force kill if needed (SIGKILL)
	//
	// For now, this is a stub that satisfies the interface
	// The actual implementation will be added when we integrate
	// with the process manager

	return nil
}
