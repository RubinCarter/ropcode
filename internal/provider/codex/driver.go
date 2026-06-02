package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"ropcode/internal/provider"
)

var _ provider.ProviderDriver = (*Driver)(nil)
var _ provider.ProviderSessionMode = (*Driver)(nil)
var _ provider.ProviderSessionIdentifier = (*Driver)(nil)

var requestSeq atomic.Uint64

const initializeRequestID = "codex_initialize_1"

type Driver struct {
	mu                 sync.Mutex
	agentMessageDeltas map[string]string
	subagentsByCallID  map[string]codexSubagentState
	subagentCallByID   map[string]string
	activeTurnByThread map[string]string
	webSearchToolUses  map[string]string
}

type codexSubagentState struct {
	CallID          string
	AgentID         string
	Prompt          string
	Description     string
	SubagentType    string
	Model           string
	ReasoningEffort string
	StartedAtMs     int64
}

func (d *Driver) UseLongLivedSession(config provider.SessionConfig) bool {
	return true
}

func (d *Driver) ProviderSessionID(event *provider.OutputEvent) string {
	if event == nil || event.Message == nil {
		return ""
	}
	if event.Subtype == "init" || event.Subtype == "thread_created" {
		if tid, ok := event.Message["thread_id"].(string); ok {
			return tid
		}
	}
	return ""
}

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
	if config.Interactive {
		return d.buildInteractiveArgs(config)
	}
	return d.buildBatchArgs(config)
}

func (d *Driver) buildInteractiveArgs(config provider.SessionConfig) []string {
	args := []string{"app-server", "--listen", "stdio://"}
	args = appendCodexUnrestrictedConfig(args, true)
	if config.Model != "" {
		args = append(args, "-c", fmt.Sprintf(`model=%q`, config.Model))
	}
	if effort, ok := config.Extra["reasoning_effort"]; ok && effort != "" {
		args = append(args, "-c", fmt.Sprintf("model_reasoning_effort=%q", effort))
	}
	return args
}

func (d *Driver) buildBatchArgs(config provider.SessionConfig) []string {
	args := []string{
		"exec",
		"--sandbox", "danger-full-access",
	}
	args = appendCodexUnrestrictedConfig(args, false)
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

func appendCodexUnrestrictedConfig(args []string, includeSandboxMode bool) []string {
	if includeSandboxMode {
		args = append(args, "-c", `sandbox_mode="danger-full-access"`)
	}
	args = append(args, "-c", `approval_policy="never"`)
	args = append(args, "-c", "sandbox_danger_full_access.network_access=true")
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
	config := session.GetConfig()
	if !config.Interactive {
		session.EnqueueMessage(msg)
		return nil
	}

	threadID := session.GetProviderSessionID()
	if threadID == "" {
		return fmt.Errorf("codex session not initialized (no thread ID)")
	}

	id := nextRequestID()
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "turn/start",
		"params": map[string]interface{}{
			"threadId": threadID,
			"input":    []map[string]interface{}{{"type": "text", "text": msg}},
		},
	}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) Interrupt(session provider.SessionHandle) error {
	config := session.GetConfig()
	if !config.Interactive {
		return session.Kill()
	}

	threadID := session.GetProviderSessionID()
	if threadID == "" {
		return session.Kill()
	}

	id := nextRequestID()
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "turn/interrupt",
		"params": map[string]interface{}{
			"threadId": threadID,
		},
	}
	targetThreadID, targetTurnID := d.currentInterruptTarget(threadID)
	req["params"].(map[string]interface{})["threadId"] = targetThreadID
	if targetTurnID != "" {
		req["params"].(map[string]interface{})["turnId"] = targetTurnID
	}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) QuerySessionActivity(session provider.SessionHandle, timeout time.Duration) (*provider.SessionActivity, error) {
	config := session.GetConfig()
	state := session.GetState()
	running := state == provider.StateRunning || state == provider.StateStarting
	if !config.Interactive {
		status := provider.SessionActivityIdle
		if running {
			status = provider.SessionActivityActive
		}
		return &provider.SessionActivity{
			Status:       status,
			Running:      running,
			Active:       running,
			CanInterrupt: running,
		}, nil
	}

	threadID := session.GetProviderSessionID()
	if threadID == "" {
		return &provider.SessionActivity{
			Status:  provider.SessionActivityUnknown,
			Running: running,
		}, nil
	}

	id := nextRequestID()
	requestID := fmt.Sprintf("%d", id)
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "thread/read",
		"params": map[string]interface{}{
			"threadId":     threadID,
			"includeTurns": true,
		},
	}
	data, _ := json.Marshal(req)
	data = append(data, '\n')

	ch, err := session.SendControlRequest(requestID, data)
	if err != nil {
		return nil, err
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case resp := <-ch:
		if resp.Err != nil {
			return nil, resp.Err
		}
		return d.activityFromThreadRead(threadID, running, resp.Data), nil
	case <-timer.C:
		session.CancelControlRequest(requestID)
		return nil, fmt.Errorf("codex thread/read timed out after %v", timeout)
	}
}

func (d *Driver) SetModel(session provider.SessionHandle, model string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
		c.Model = model
	})
	config := session.GetConfig()
	if !config.Interactive {
		return nil
	}

	threadID := session.GetProviderSessionID()
	if threadID == "" {
		return nil
	}

	id := nextRequestID()
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "thread/settings/update",
		"params": map[string]interface{}{
			"threadId": threadID,
			"settings": map[string]interface{}{
				"model": model,
			},
		},
	}
	data, _ := json.Marshal(req)
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) SetPermissionMode(session provider.SessionHandle, mode string) error {
	return nil
}

func (d *Driver) UpdateEnvironmentVariables(session provider.SessionHandle, vars map[string]string) error {
	session.UpdateConfig(func(c *provider.SessionConfig) {
		if v, ok := vars["AUTH_TOKEN"]; ok {
			c.AuthToken = v
		}
		if v, ok := vars["BASE_URL"]; ok {
			c.BaseURL = v
		}
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
	config := session.GetConfig()
	if !config.Interactive {
		return nil
	}
	return session.WaitForInit(timeout)
}

func (d *Driver) OnProcessStart(_ context.Context, session provider.SessionHandle, _ int) error {
	config := session.GetConfig()
	if !config.Interactive {
		return nil
	}

	// 1. Send initialize
	initReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      initializeRequestID,
		"method":  "initialize",
		"params": map[string]interface{}{
			"clientInfo": map[string]interface{}{
				"name":    "ropcode",
				"version": "0.1.0",
			},
		},
	}
	data, _ := json.Marshal(initReq)
	data = append(data, '\n')
	if err := session.WriteStdin(data); err != nil {
		return err
	}

	// 2. Send thread/start (or thread/resume)
	method := "thread/start"
	params := map[string]interface{}{}
	if config.ResumeSessionID != "" {
		method = "thread/resume"
		params["threadId"] = config.ResumeSessionID
	}

	threadReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      "thread_1",
		"method":  method,
		"params":  params,
	}
	data, _ = json.Marshal(threadReq)
	data = append(data, '\n')
	return session.WriteStdin(data)
}

func (d *Driver) OnProcessExit(session provider.SessionHandle, exitCode int, err error) {
	config := session.GetConfig()
	if config.Interactive {
		return
	}
	if msg, ok := session.DequeueMessage(); ok {
		cfg := session.GetConfig()
		cfg.Prompt = msg
		cfg.ResumeSessionID = session.GetProviderSessionID()
		cfg.Resume = true
		session.RestartWithConfig(cfg)
	}
}

// --- HistoryProvider implementation ---

func (d *Driver) LoadSessionHistory(projectID, sessionID string) ([]provider.Message, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	return LoadSessionHistory(dir, projectID, sessionID)
}

func (d *Driver) LoadHistoryEvents(projectID, sessionID string) ([]provider.OutputEvent, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	return LoadHistoryEvents(dir, sessionID)
}

func (d *Driver) ListProjectSessions(projectPath string) ([]provider.HistorySessionInfo, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	return ListProjectSessions(dir, projectPath)
}

func (d *Driver) ListProjectSessionsLimit(projectPath string, limit int) (provider.HistorySessionsResult, error) {
	dir, err := CodexDir()
	if err != nil {
		return provider.HistorySessionsResult{}, err
	}
	return ListProjectSessionsLimit(dir, projectPath, limit)
}

func (d *Driver) GetMessageIndex(projectID, sessionID string) ([]int, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	filePath, err := FindSessionFile(dir, sessionID)
	if err != nil {
		return nil, err
	}
	return buildLineIndex(filePath)
}

func (d *Driver) GetMessagesRange(projectID, sessionID string, start, end int) ([]provider.Message, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	filePath, err := FindSessionFile(dir, sessionID)
	if err != nil {
		return nil, err
	}
	return readMessagesRange(filePath, start, end)
}

func buildLineIndex(filePath string) ([]int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var lineNumbers []int
	lineNum := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		lineNum++
		if len(scanner.Bytes()) > 0 {
			lineNumbers = append(lineNumbers, lineNum)
		}
	}
	return lineNumbers, scanner.Err()
}

func readMessagesRange(filePath string, start, end int) ([]provider.Message, error) {
	if start < 1 || end < start {
		return nil, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var messages []provider.Message
	lineNum := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		lineNum++
		if lineNum < start {
			continue
		}
		if lineNum > end {
			break
		}
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal(line, &raw); err != nil {
			continue
		}
		event := NormalizeHistoryEntry(raw)
		messages = append(messages, provider.Message{
			Type:      event.Type,
			Timestamp: str(raw, "timestamp"),
			Message:   event.Message,
		})
	}
	return messages, scanner.Err()
}

func (d *Driver) LoadSubagentTranscripts(projectID, sessionID string) (map[string][]provider.Message, error) {
	dir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	return LoadSubagentTranscripts(dir, sessionID)
}

func (d *Driver) activityFromThreadRead(threadID string, running bool, raw map[string]interface{}) *provider.SessionActivity {
	activity := &provider.SessionActivity{
		ProviderSessionID: threadID,
		Status:            provider.SessionActivityUnknown,
		Running:           running,
	}
	result, _ := raw["result"].(map[string]interface{})
	thread, _ := result["thread"].(map[string]interface{})
	if thread == nil {
		if errObj, ok := raw["error"].(map[string]interface{}); ok {
			activity.Status = provider.SessionActivityError
			activity.Error = fmt.Sprint(errObj["message"])
		}
		return activity
	}

	threadStatus := ""
	if status, ok := thread["status"].(map[string]interface{}); ok {
		threadStatus, _ = status["type"].(string)
	}
	activity.ThreadStatus = threadStatus
	switch threadStatus {
	case "active":
		activity.Status = provider.SessionActivityActive
		activity.Active = true
		activity.CanInterrupt = true
	case "idle", "notLoaded":
		activity.Status = provider.SessionActivityIdle
	case "systemError":
		activity.Status = provider.SessionActivityError
	default:
		activity.Status = provider.SessionActivityUnknown
	}

	if turnID := d.activeTurnFromThread(thread); turnID != "" {
		activity.TurnID = turnID
		d.mu.Lock()
		if d.activeTurnByThread == nil {
			d.activeTurnByThread = make(map[string]string)
		}
		d.activeTurnByThread[threadID] = turnID
		d.mu.Unlock()
		activity.Status = provider.SessionActivityActive
		activity.Active = true
		activity.CanInterrupt = true
	}
	if _, subagentTurnID := d.activeSubagentTurn(); subagentTurnID != "" {
		activity.ThreadStatus = "active"
		activity.TurnID = subagentTurnID
		activity.Status = provider.SessionActivityActive
		activity.Active = true
		activity.CanInterrupt = true
	}
	activity.UpdatedAt = time.Now()
	return activity
}

func (d *Driver) activeTurnFromThread(thread map[string]interface{}) string {
	turns, _ := thread["turns"].([]interface{})
	for i := len(turns) - 1; i >= 0; i-- {
		turn, _ := turns[i].(map[string]interface{})
		if turn == nil {
			continue
		}
		status, _ := turn["status"].(string)
		if status == "inProgress" {
			id, _ := turn["id"].(string)
			return id
		}
	}
	return ""
}

func nextRequestID() int {
	return int(requestSeq.Add(1))
}

func (d *Driver) currentInterruptTarget(rootThreadID string) (string, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if turnID := d.activeTurnByThread[rootThreadID]; turnID != "" {
		return rootThreadID, turnID
	}
	threadID, turnID := d.activeSubagentTurnLocked()
	if threadID != "" && turnID != "" {
		return threadID, turnID
	}
	return rootThreadID, ""
}

func (d *Driver) activeSubagentTurn() (string, string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeSubagentTurnLocked()
}

func (d *Driver) activeSubagentTurnLocked() (string, string) {
	for _, state := range d.subagentsByCallID {
		if state.AgentID == "" {
			continue
		}
		if turnID := d.activeTurnByThread[state.AgentID]; turnID != "" {
			return state.AgentID, turnID
		}
	}
	return "", ""
}
