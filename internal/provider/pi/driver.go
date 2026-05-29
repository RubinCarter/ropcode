package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)

var requestSeq atomic.Uint64

type Driver struct{}

func (d *Driver) ID() string         { return "pi" }
func (d *Driver) BinaryName() string { return "pi" }

func (d *Driver) BinaryCandidates() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin/pi",
		"/usr/local/bin/pi",
		"/usr/bin/pi",
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".local", "bin", "pi"),
			filepath.Join(home, ".npm-global", "bin", "pi"),
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
		paths = append(paths, filepath.Join(localAppData, "npm", "pi.cmd"))
	}
	if appData != "" {
		paths = append(paths, filepath.Join(appData, "npm", "pi.cmd"))
	}
	if home != "" {
		paths = append(paths,
			filepath.Join(home, "scoop", "shims", "pi.exe"),
			filepath.Join(home, "scoop", "shims", "pi.cmd"),
		)
	}
	paths = append(paths,
		`C:\Program Files\nodejs\pi.cmd`,
		`C:\ProgramData\npm\npm\pi.cmd`,
		`C:\ProgramData\npm\npm\pi.ps1`,
	)
	return paths
}

func (d *Driver) BuildArgs(config provider.SessionConfig) []string {
	args := []string{"--mode", "rpc"}
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	if config.Extra != nil {
		if thinkingLevel := config.Extra["thinking_level"]; thinkingLevel != "" {
			args = append(args, "--thinking", thinkingLevel)
		}
		if sessionDir := config.Extra["session_dir"]; sessionDir != "" {
			args = append(args, "--session-dir", sessionDir)
		}
	}
	return args
}

func (d *Driver) EnvVars(config provider.SessionConfig) map[string]string {
	vars := make(map[string]string)
	if config.AuthToken != "" {
		if key := apiKeyEnvForModel(config.Model); key != "" {
			vars[key] = config.AuthToken
		} else {
			vars["ANTHROPIC_API_KEY"] = config.AuthToken
			vars["OPENAI_API_KEY"] = config.AuthToken
			vars["GEMINI_API_KEY"] = config.AuthToken
		}
	}
	for k, v := range config.Extra {
		if len(k) > 4 && k[:4] == "env_" {
			vars[k[4:]] = v
		}
	}
	return vars
}

func (d *Driver) SendMessage(session provider.SessionHandle, msg string) error {
	return writePrompt(session, msg, true)
}

func (d *Driver) Interrupt(session provider.SessionHandle) error {
	data, err := commandJSON(map[string]interface{}{
		"id":   nextRequestID(),
		"type": "abort",
	})
	if err != nil {
		return err
	}
	return session.WriteStdin(data)
}

func (d *Driver) SetModel(session provider.SessionHandle, model string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
		c.Model = model
	})

	providerID, modelID := splitModel(model)
	data, err := commandJSON(map[string]interface{}{
		"id":       nextRequestID(),
		"type":     "set_model",
		"provider": providerID,
		"modelId":  modelID,
	})
	if err != nil {
		return err
	}
	return session.WriteStdin(data)
}

func (d *Driver) SetPermissionMode(session provider.SessionHandle, mode string) error {
	return nil
}

func (d *Driver) UpdateEnvironmentVariables(session provider.SessionHandle, vars map[string]string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
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

func (d *Driver) OnProcessStart(_ context.Context, session provider.SessionHandle, _ int) error {
	config := session.GetConfig()
	if config.Prompt == "" {
		return nil
	}
	return writePrompt(session, config.Prompt, false)
}

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {}

func writePrompt(session provider.SessionHandle, msg string, followUp bool) error {
	data, err := promptCommand(nextRequestID(), msg, followUp)
	if err != nil {
		return err
	}
	return session.WriteStdin(data)
}

func writeThinkingLevel(session provider.SessionHandle, level string) error {
	data, err := commandJSON(map[string]interface{}{
		"id":    nextRequestID(),
		"type":  "set_thinking_level",
		"level": level,
	})
	if err != nil {
		return err
	}
	return session.WriteStdin(data)
}

func promptCommand(id, message string, followUp bool) ([]byte, error) {
	cmd := map[string]interface{}{
		"id":      id,
		"type":    "prompt",
		"message": message,
	}
	if followUp {
		cmd["streamingBehavior"] = "followUp"
	}
	return commandJSON(cmd)
}

func commandJSON(cmd map[string]interface{}) ([]byte, error) {
	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')
	return data, nil
}

func nextRequestID() string {
	return fmt.Sprintf("ropcode-pi-%d", requestSeq.Add(1))
}

func splitModel(model string) (string, string) {
	for i, r := range model {
		if r == '/' {
			return model[:i], model[i+1:]
		}
	}
	return "", model
}

func apiKeyEnvForModel(model string) string {
	providerID, _ := splitModel(model)
	switch providerID {
	case "anthropic":
		return "ANTHROPIC_API_KEY"
	case "openai":
		return "OPENAI_API_KEY"
	case "google", "gemini":
		return "GEMINI_API_KEY"
	case "deepseek":
		return "DEEPSEEK_API_KEY"
	case "groq":
		return "GROQ_API_KEY"
	case "cerebras":
		return "CEREBRAS_API_KEY"
	case "xai":
		return "XAI_API_KEY"
	case "fireworks":
		return "FIREWORKS_API_KEY"
	case "together":
		return "TOGETHER_API_KEY"
	case "openrouter":
		return "OPENROUTER_API_KEY"
	case "ai-gateway":
		return "AI_GATEWAY_API_KEY"
	case "zai":
		return "ZAI_API_KEY"
	case "mistral":
		return "MISTRAL_API_KEY"
	case "minimax":
		return "MINIMAX_API_KEY"
	case "moonshot", "kimi":
		return "MOONSHOT_API_KEY"
	case "opencode":
		return "OPENCODE_API_KEY"
	case "cloudflare":
		return "CLOUDFLARE_API_KEY"
	default:
		return ""
	}
}

// --- HistoryProvider implementation ---

func (d *Driver) LoadSessionHistory(projectID, sessionID string) ([]provider.Message, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return LoadSessionHistory(dir, projectID, sessionID)
}

func (d *Driver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return LoadHistoryEvents(dir, sessionID)
}

func (d *Driver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return ListProjectSessions(dir, projectPath)
}

func (d *Driver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	dir, err := PiDir()
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	return ListProjectSessionsLimit(dir, projectPath, limit)
}

func (d *Driver) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return GetMessageIndex(dir, projectID, sessionID)
}

func (d *Driver) GetMessagesRange(projectID, sessionID string, start, end int) ([]provider.Message, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return GetMessagesRange(dir, projectID, sessionID, start, end)
}

func (d *Driver) LoadSubagentTranscripts(projectID, sessionID string) (map[string][]provider.Message, error) {
	dir, err := PiDir()
	if err != nil {
		return nil, err
	}
	return LoadSubagentTranscripts(dir, sessionID)
}
