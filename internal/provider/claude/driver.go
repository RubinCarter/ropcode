package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)

type Driver struct{}

func (d *Driver) ID() string         { return "claude" }
func (d *Driver) BinaryName() string { return "claude" }

func (d *Driver) BinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".npm-global", "bin", "claude"),
			filepath.Join(home, ".local", "bin", "claude"),
		)
	}
	return candidates
}

func (d *Driver) BuildArgs(config provider.SessionConfig) []string {
	if config.Interactive {
		return d.buildInteractiveArgs(config)
	}
	return d.buildBatchArgs(config)
}

func (d *Driver) buildBatchArgs(config provider.SessionConfig) []string {
	var args []string
	if config.Resume && config.ResumeSessionID != "" {
		args = append(args, "--resume", config.ResumeSessionID)
	}
	if config.Prompt != "" {
		args = append(args, "-p", config.Prompt)
	}
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	args = append(args, "--output-format", "stream-json")
	args = append(args, "--verbose")
	args = append(args, "--dangerously-skip-permissions")

	if home, err := os.UserHomeDir(); err == nil {
		claudeDir := filepath.Join(home, ".claude")
		if _, statErr := os.Stat(claudeDir); statErr == nil {
			args = append(args, "--add-dir", claudeDir)
		}
	}
	return args
}

func (d *Driver) buildInteractiveArgs(config provider.SessionConfig) []string {
	args := []string{"--print", "--input-format", "stream-json"}
	if config.ResumeSessionID != "" {
		args = append(args, "--resume", config.ResumeSessionID)
	}
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	args = append(args, "--output-format", "stream-json")
	args = append(args, "--verbose")
	args = append(args, "--dangerously-skip-permissions")
	return args
}

func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string {
	vars := map[string]string{
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "true",
	}
	if config.BaseURL != "" {
		vars["ANTHROPIC_BASE_URL"] = config.BaseURL
	}
	if config.AuthToken != "" {
		vars["ANTHROPIC_AUTH_TOKEN"] = config.AuthToken
	}
	return vars
}

func (d *Driver) SendMessage(session provider.SessionHandle, msg string) error {
	payload := map[string]interface{}{
		"type": "user",
		"message": map[string]interface{}{
			"role": "user",
			"content": []map[string]interface{}{
				{"type": "text", "text": msg},
			},
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) Interrupt(session provider.SessionHandle) error {
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": "interrupt",
		"request": map[string]interface{}{
			"subtype": "interrupt",
		},
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal interrupt: %w", err)
	}
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) OnProcessStart(_ context.Context, _ int) error { return nil }

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
	// Claude interactive mode: process exit means session ended.
	// No message queue logic — Claude handles multi-turn natively via stdin.
}
