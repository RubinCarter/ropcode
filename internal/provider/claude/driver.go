package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ropcode/internal/claudeactivity"
	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)
var _ provider.ProviderSessionMode = (*Driver)(nil)
var _ provider.ProviderSessionIdentifier = (*Driver)(nil)
var _ provider.ProviderCapabilityPassthrough = (*Driver)(nil)

type Driver struct {
	Activity         *claudeactivity.Service
	CapabilitySource CapabilitySource
}

func (d *Driver) UseLongLivedSession(config provider.SessionConfig) bool {
	return true
}

func (d *Driver) ProviderSessionID(event *provider.OutputEvent) string {
	if event == nil || event.Subtype != "init" || event.Message == nil {
		return ""
	}
	if sid, ok := event.Message["session_id"].(string); ok {
		return sid
	}
	return ""
}

func (d *Driver) AllowRawCapabilityInvocation(capability provider.Capability) bool {
	return true
}

func ClaudeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude"), nil
}

// --- HistoryProvider implementation ---

func (d *Driver) LoadSessionHistory(projectID, sessionID string) ([]provider.Message, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	var filePath string
	if projectID == "" {
		filePath = GetAgentSessionFilePath(dir, sessionID)
	} else {
		filePath, err = FindSessionFile(dir, projectID, sessionID)
		if err != nil {
			return nil, err
		}
	}
	return ReadAllMessages(filePath)
}

func (d *Driver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	filePath, err := FindSessionFile(dir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	entries, err := ReadAllHistoryEntries(filePath)
	if err != nil {
		return nil, err
	}
	events := make([]provider.OutputEvent, 0, len(entries))
	for _, raw := range entries {
		events = append(events, NormalizeHistoryEntry(raw))
	}
	return events, nil
}

func (d *Driver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	return ListProjectSessions(dir, projectPath)
}

func (d *Driver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	return ListProjectSessionsLimit(dir, projectPath, limit)
}

func (d *Driver) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	filePath, err := FindSessionFile(dir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	index, err := BuildMessageIndex(filePath)
	if err != nil {
		return nil, err
	}
	return index.LineNumbers, nil
}

func (d *Driver) GetMessagesRange(projectID, sessionID string, start, end int) ([]provider.Message, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	filePath, err := FindSessionFile(dir, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	return ReadMessagesRange(filePath, start, end)
}

func (d *Driver) LoadSubagentTranscripts(projectID, sessionID string) (map[string][]provider.Message, error) {
	dir, err := ClaudeDir()
	if err != nil {
		return nil, err
	}
	return ReadSubagentTranscripts(dir, projectID, sessionID)
}

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
		"CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS":    "true",
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

func (d *Driver) SetModel(session provider.SessionHandle, model string) error {
	return d.sendControlRequestAndWait(session, "set_model", map[string]interface{}{
		"subtype": "set_model",
		"model":   model,
	})
}

func (d *Driver) SetPermissionMode(session provider.SessionHandle, mode string) error {
	return d.sendControlRequestAndWait(session, "set_permission_mode", map[string]interface{}{
		"subtype":         "set_permission_mode",
		"permission_mode": mode,
	})
}

func (d *Driver) UpdateEnvironmentVariables(session provider.SessionHandle, vars map[string]string) error {
	normalized := make(map[string]string, len(vars)+2)
	for k, v := range vars {
		normalized[k] = v
	}
	if v, ok := normalized["AUTH_TOKEN"]; ok {
		normalized["ANTHROPIC_AUTH_TOKEN"] = v
		delete(normalized, "AUTH_TOKEN")
	}
	if v, ok := normalized["BASE_URL"]; ok {
		normalized["ANTHROPIC_BASE_URL"] = v
		delete(normalized, "BASE_URL")
	}
	envelope := map[string]interface{}{
		"type":      "update_environment_variables",
		"variables": normalized,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal env update: %w", err)
	}
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) WaitForInit(session provider.SessionHandle, timeout time.Duration) error {
	return session.WaitForInit(timeout)
}

func (d *Driver) QuerySessionActivity(session provider.SessionHandle, timeout time.Duration) (*provider.SessionActivity, error) {
	activity := provider.DefaultSessionActivity(session)
	if d.Activity == nil {
		return activity, nil
	}
	if snapshot, err := d.Activity.GetSnapshot(session.GetSessionID()); err == nil && activity.Running && snapshot.RunningCount > 0 {
		activity.Status = provider.SessionActivityActive
		activity.Running = true
		activity.Active = true
		activity.CanInterrupt = true
		if activity.ThreadStatus == "" {
			activity.ThreadStatus = "active"
		}
	}
	return activity, nil
}

func (d *Driver) sendControlRequestAndWait(session provider.SessionHandle, requestID string, request map[string]interface{}) error {
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": requestID,
		"request":    request,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal control request: %w", err)
	}
	data = append(data, '\n')

	ch, err := session.SendControlRequest(requestID, data)
	if err != nil {
		return err
	}

	select {
	case resp := <-ch:
		if resp.Err != nil {
			return resp.Err
		}
		return nil
	case <-time.After(10 * time.Second):
		return fmt.Errorf("control request %q timed out", requestID)
	}
}

func (d *Driver) OnProcessStart(_ context.Context, session provider.SessionHandle, _ int) error {
	config := session.GetConfig()
	if !config.Interactive {
		return nil
	}
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": "init_1",
		"request": map[string]interface{}{
			"subtype": "initialize",
		},
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal init request: %w", err)
	}
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
	// Claude interactive mode: process exit means session ended.
	// No message queue logic — Claude handles multi-turn natively via stdin.
}
