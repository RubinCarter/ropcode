package codex

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)

type Driver struct{}

func (d *Driver) ID() string         { return "codex" }
func (d *Driver) BinaryName() string { return "codex" }

func (d *Driver) BinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
		"/usr/bin/codex",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "codex"),
			filepath.Join(home, ".cargo", "bin", "codex"),
			filepath.Join(home, ".npm-global", "bin", "codex"),
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
		paths = append(paths,
			filepath.Join(localAppData, "Microsoft", "WindowsApps", "*", "codex.exe"),
			filepath.Join(localAppData, "npm", "codex.cmd"),
		)
	}
	if appData != "" {
		paths = append(paths, filepath.Join(appData, "npm", "codex.cmd"))
	}
	if home != "" {
		paths = append(paths,
			filepath.Join(home, "scoop", "shims", "codex.exe"),
		)
	}
	paths = append(paths, `C:\Program Files\nodejs\codex.cmd`)
	return paths
}

func (d *Driver) BuildArgs(config provider.SessionConfig) []string {
	args := []string{
		"exec",
		"--sandbox", "danger-full-access",
	}
	args = append(args, "-c", `approval_policy="never"`)
	args = append(args, "-c", "sandbox_danger_full_access.network_access=true")

	if config.Model != "" {
		args = append(args, "-m", config.Model)
	}
	if effort, ok := config.Extra["reasoning_effort"]; ok && effort != "" {
		args = append(args, "-c", fmt.Sprintf("model_reasoning_effort=%q", effort))
	}
	if config.ProjectPath != "" {
		args = append(args, "-C", config.ProjectPath)
	}
	args = append(args, "--json")
	args = append(args, "--color", "never")
	args = append(args, "--")
	args = append(args, config.Prompt)
	return args
}

func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string {
	vars := make(map[string]string)
	if config.AuthToken != "" {
		vars["OPENAI_API_KEY"] = config.AuthToken
		vars["CRS_OAI_KEY"] = config.AuthToken
	}
	if config.BaseURL != "" {
		vars["OPENAI_BASE_URL"] = config.BaseURL
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
		if v, ok := vars["OPENAI_API_KEY"]; ok {
			c.AuthToken = v
		}
		if v, ok := vars["OPENAI_BASE_URL"]; ok {
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

func (d *Driver) OnProcessStart(_ context.Context, _ int) error { return nil }

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
	if msg, ok := session.DequeueMessage(); ok {
		config := session.GetConfig()
		config.Prompt = msg
		config.ResumeSessionID = session.GetProviderSessionID()
		config.Resume = true
		session.RestartWithConfig(config)
	}
}
