package deepseek

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)

type Driver struct{}

func (d *Driver) ID() string         { return "deepseek" }
func (d *Driver) BinaryName() string { return "deepseek" }

func (d *Driver) BinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/deepseek",
		"/usr/local/bin/deepseek",
		"/usr/bin/deepseek",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "deepseek"),
			filepath.Join(home, ".cargo", "bin", "deepseek"),
			filepath.Join(home, ".npm-global", "bin", "deepseek"),
		)
	}
	if runtime.GOOS == "windows" {
		candidates = append(candidates, windowsCandidates()...)
	}
	return candidates
}

func windowsCandidates() []string {
	home, _ := os.UserHomeDir()
	appData := os.Getenv("APPDATA")
	localAppData := os.Getenv("LOCALAPPDATA")

	var paths []string
	if localAppData != "" {
		paths = append(paths, filepath.Join(localAppData, "npm", "deepseek.cmd"))
	}
	if appData != "" {
		paths = append(paths, filepath.Join(appData, "npm", "deepseek.cmd"))
	}
	if home != "" {
		paths = append(paths,
			filepath.Join(home, "scoop", "shims", "deepseek.exe"),
			filepath.Join(home, ".cargo", "bin", "deepseek.exe"),
		)
	}
	return paths
}

func (d *Driver) BuildArgs(config provider.SessionConfig) []string {
	args := []string{"exec", "--auto", "--output-format", "stream-json"}
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	if config.Resume && config.ResumeSessionID != "" {
		args = append(args, "--resume", config.ResumeSessionID)
	}
	args = append(args, "--", config.Prompt)
	return args
}

func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string {
	vars := make(map[string]string)
	if config.AuthToken != "" {
		vars["DEEPSEEK_API_KEY"] = config.AuthToken
	}
	if config.BaseURL != "" {
		vars["DEEPSEEK_BASE_URL"] = config.BaseURL
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
		if v, ok := vars["DEEPSEEK_API_KEY"]; ok {
			c.AuthToken = v
		}
		if v, ok := vars["DEEPSEEK_BASE_URL"]; ok {
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
	dir, err := DeepSeekDir()
	if err != nil {
		return nil, err
	}
	return LoadSessionHistory(dir, projectID, sessionID)
}

func (d *Driver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	dir, err := DeepSeekDir()
	if err != nil {
		return nil, err
	}
	raw, err := ReadHistoryDocument(dir, sessionID)
	if err != nil {
		return nil, err
	}
	return NormalizeHistoryDocument(raw), nil
}

func (d *Driver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	dir, err := DeepSeekDir()
	if err != nil {
		return nil, err
	}
	return ListProjectSessions(dir, projectPath)
}

func (d *Driver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	dir, err := DeepSeekDir()
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	return ListProjectSessionsLimit(dir, projectPath, limit)
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
