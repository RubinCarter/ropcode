package gemini

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)

type Driver struct{}

func (d *Driver) ID() string         { return "gemini" }
func (d *Driver) BinaryName() string { return "gemini" }

func (d *Driver) BinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/gemini",
		"/usr/local/bin/gemini",
		"/usr/bin/gemini",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "gemini"),
			filepath.Join(home, ".npm-global", "bin", "gemini"),
		)
	}
	return candidates
}

func (d *Driver) BuildArgs(config provider.SessionConfig) []string {
	var args []string
	if config.Model != "" {
		args = append(args, "-m", config.Model)
	}
	args = append(args, "-o", "stream-json")
	args = append(args, "--approval-mode", "yolo")
	args = append(args, config.Prompt)
	return args
}

func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string {
	vars := make(map[string]string)
	if config.AuthToken != "" {
		vars["GEMINI_API_KEY"] = config.AuthToken
	}
	if config.BaseURL != "" {
		vars["GOOGLE_GEMINI_BASE_URL"] = config.BaseURL
		vars["GOOGLE_GENAI_USE_GCA"] = "true"
	}
	for k, v := range config.Extra {
		if len(k) > 4 && k[:4] == "env_" {
			vars[k[4:]] = v
		}
	}
	return vars
}

func (d *Driver) SendMessage(session provider.SessionHandle, msg string) error {
	session.EnqueueMessage(msg)
	return nil
}

func (d *Driver) Interrupt(session provider.SessionHandle) error {
	return session.Kill()
}

func (d *Driver) SetModel(session provider.SessionHandle, model string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
		c.Model = model
	})
	return nil
}

func (d *Driver) SetPermissionMode(session provider.SessionHandle, mode string) error {
	return nil
}

func (d *Driver) UpdateEnvironmentVariables(session provider.SessionHandle, vars map[string]string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
		if v, ok := vars["GEMINI_API_KEY"]; ok {
			c.AuthToken = v
		}
		if v, ok := vars["GOOGLE_GEMINI_BASE_URL"]; ok {
			c.BaseURL = v
		}
		if c.Extra == nil {
			c.Extra = make(map[string]string)
		}
		for k, v := range vars {
			c.Extra["env_"+k] = v
		}
	})
	return nil
}

func (d *Driver) WaitForInit(session provider.SessionHandle, timeout time.Duration) error {
	return nil
}

func (d *Driver) OnProcessStart(_ context.Context, _ provider.SessionHandle, _ int) error { return nil }

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
	if msg, ok := session.DequeueMessage(); ok {
		config := session.GetConfig()
		config.Prompt = msg
		config.ResumeSessionID = session.GetProviderSessionID()
		config.Resume = true
		session.RestartWithConfig(config)
	}
}

// --- HistoryProvider implementation ---

func (d *Driver) LoadSessionHistory(projectID, sessionID string) ([]provider.Message, error) {
	dir, err := GeminiDir()
	if err != nil {
		return nil, err
	}
	return LoadSessionHistory(dir, projectID, sessionID)
}

func (d *Driver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	return nil, nil
}

func (d *Driver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	return nil, nil
}

func (d *Driver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	return provider.HistorySessionsResult{}, nil
}

func (d *Driver) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	return nil, nil
}

func (d *Driver) GetMessagesRange(projectID, sessionID string, start, end int) ([]provider.Message, error) {
	return nil, nil
}

func (d *Driver) LoadSubagentTranscripts(projectID, sessionID string) (map[string][]provider.Message, error) {
	return nil, nil
}
