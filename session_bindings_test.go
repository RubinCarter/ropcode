package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/provider"
	providerClaude "ropcode/internal/provider/claude"
	providerCodex "ropcode/internal/provider/codex"
	providerDeepseek "ropcode/internal/provider/deepseek"
	providerGemini "ropcode/internal/provider/gemini"
	providerPi "ropcode/internal/provider/pi"
)

func writeFakeProviderBinary(t *testing.T) string {
	t.Helper()

	if runtime.GOOS == "windows" {
		binPath := filepath.Join(t.TempDir(), "fake-provider.cmd")
		script := "@echo off\r\necho provider-started\r\n:loop\r\ntimeout /t 1 /nobreak >nul\r\ngoto loop\r\n"
		if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		return binPath
	}

	binPath := filepath.Join(t.TempDir(), "fake-provider.sh")
	script := "#!/bin/sh\nprintf 'provider-started\\n'\ntrap 'exit 0' INT TERM\nwhile true; do sleep 1; done\n"
	if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	return binPath
}

func waitUntil(t *testing.T, timeout time.Duration, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func newGeminiTestApp(t *testing.T) *App {
	t.Helper()
	mgr := newTestProviderManager(t)
	return &App{providerManager: mgr}
}

func newCodexTestApp(t *testing.T) *App {
	t.Helper()
	mgr := newTestProviderManager(t)
	return &App{providerManager: mgr}
}

func newDeepSeekTestApp(t *testing.T) *App {
	t.Helper()
	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("database.Open failed: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	mgr := newTestProviderManager(t)
	return &App{dbManager: db, providerManager: mgr}
}

func newTestProviderManager(t *testing.T) *provider.Manager {
	t.Helper()
	ctx := context.Background()
	mgr := provider.NewManager(ctx, nil, nil)
	mgr.RegisterDriver(&providerClaude.Driver{})
	mgr.RegisterDriver(&providerCodex.Driver{})
	mgr.RegisterDriver(&providerGemini.Driver{})
	mgr.RegisterDriver(&providerDeepseek.Driver{})
	mgr.RegisterDriver(&providerPi.Driver{})

	fakeBin := writeFakeProviderBinary(t)
	mgr.SetBinaryPath("claude", fakeBin)
	mgr.SetBinaryPath("codex", fakeBin)
	mgr.SetBinaryPath("gemini", fakeBin)
	mgr.SetBinaryPath("deepseek", fakeBin)
	mgr.SetBinaryPath("pi", fakeBin)
	return mgr
}

func runningSessionConfig(t *testing.T, mgr *provider.Manager, sessionID string) (string, string, string) {
	t.Helper()
	status := mgr.GetSession(sessionID)
	if status == nil {
		t.Fatalf("session %q not found in provider manager", sessionID)
	}
	reasoningEffort := ""
	if status.Extra != nil {
		reasoningEffort = status.Extra["reasoning_effort"]
	}
	return status.Model, status.ProviderApiID, reasoningEffort
}

func TestListRunningProviderSessions_IncludesProviderMetadata(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	sessionID, err := app.StartProviderSession("gemini", projectPath, "hello", "gemini-test", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	waitUntil(t, 2*time.Second, func() bool {
		sessions := app.ListRunningProviderSessions()
		return len(sessions) == 1
	})

	sessions := app.ListRunningProviderSessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 running session, got %d", len(sessions))
	}
	if sessions[0].Provider != "gemini" {
		t.Fatalf("expected provider gemini, got %q", sessions[0].Provider)
	}
	if sessions[0].SessionID != sessionID {
		t.Fatalf("expected session id %q, got %q", sessionID, sessions[0].SessionID)
	}
	if sessions[0].ProjectPath != projectPath {
		t.Fatalf("expected project path %q, got %q", projectPath, sessions[0].ProjectPath)
	}
}

func TestStartProviderSessionUsesDeepSeekDefaultProviderApiConfig(t *testing.T) {
	app := newDeepSeekTestApp(t)
	projectPath := t.TempDir()
	apiCfg := &database.ProviderApiConfig{
		ID:         "deepseek-default-cfg",
		Name:       "DeepSeek Default",
		ProviderID: "deepseek",
		BaseURL:    "https://api.deepseek.example/v1",
		AuthToken:  "deepseek-token",
		IsDefault:  true,
	}
	if err := app.dbManager.SaveProviderApiConfig(apiCfg); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}

	sessionID, err := app.StartProviderSession("deepseek", projectPath, "hello", "deepseek-v4-pro", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	_, gotProviderApiID, _ := runningSessionConfig(t, app.providerManager, sessionID)
	if gotProviderApiID != apiCfg.ID {
		t.Fatalf("expected DeepSeek default providerApiID %q, got %q", apiCfg.ID, gotProviderApiID)
	}
}

func TestResumeProviderSessionUsesDeepSeekDefaultProviderApiConfig(t *testing.T) {
	app := newDeepSeekTestApp(t)
	projectPath := t.TempDir()
	apiCfg := &database.ProviderApiConfig{
		ID:         "deepseek-default-cfg",
		Name:       "DeepSeek Default",
		ProviderID: "deepseek",
		BaseURL:    "https://api.deepseek.example/v1",
		AuthToken:  "deepseek-token",
		IsDefault:  true,
	}
	if err := app.dbManager.SaveProviderApiConfig(apiCfg); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}

	sessionID, err := app.ResumeProviderSession("deepseek", projectPath, "hello again", "deepseek-v4-pro", "upstream-session-id", "", "")
	if err != nil {
		t.Fatalf("ResumeProviderSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	_, gotProviderApiID, _ := runningSessionConfig(t, app.providerManager, sessionID)
	if gotProviderApiID != apiCfg.ID {
		t.Fatalf("expected DeepSeek default providerApiID %q, got %q", apiCfg.ID, gotProviderApiID)
	}
}

func TestLiveProviderSessionExposesProviderSessionID(t *testing.T) {
	var session LiveProviderSession
	session.ProviderSessionID = "provider-session-id"

	if session.ProviderSessionID != "provider-session-id" {
		t.Fatalf("expected provider session id to be stored, got %q", session.ProviderSessionID)
	}
}

func writeFakeClaudeInteractiveBinary(t *testing.T) string {
	t.Helper()

	claudeID := "claude-provider-session"
	initLine := `{"type":"system","subtype":"init","session_id":"` + claudeID + `"}`
	controlLine := `{"type":"control_response","request_id":"init_1","response":{"subtype":"success","request_id":"init_1"}}`
	if runtime.GOOS == "windows" {
		binPath := filepath.Join(t.TempDir(), "fake-claude.cmd")
		script := "@echo off\r\necho " + initLine + "\r\necho " + controlLine + "\r\n:loop\r\nset /p line=\r\nif errorlevel 1 goto end\r\necho {\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"" + claudeID + "\"}\r\ngoto loop\r\n:end\r\n"
		if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		return binPath
	}

	binPath := filepath.Join(t.TempDir(), "fake-claude.sh")
	script := "#!/bin/sh\nprintf '%s\\n' '" + initLine + "'\nprintf '%s\\n' '" + controlLine + "'\nwhile IFS= read -r line; do printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"" + claudeID + "\"}'; done\n"
	if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	return binPath
}

func TestSendClaudeMessageAcceptsProviderSessionIDForRunningSession(t *testing.T) {
	app := newGeminiTestApp(t)
	app.providerManager.SetBinaryPath("claude", writeFakeClaudeInteractiveBinary(t))
	projectPath := t.TempDir()

	sessionID, err := app.StartInteractiveClaudeSession(projectPath, "sonnet", "", "")
	if err != nil {
		t.Fatalf("StartInteractiveClaudeSession failed: %v", err)
	}
	defer func() { _ = app.StopProviderSession(sessionID) }()

	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 1
	})

	session := app.providerManager.GetSession(sessionID)
	if session == nil {
		t.Fatal("expected running provider session")
	}
	if session.ProviderSessionID == "" {
		t.Fatal("expected provider session id")
	}

	if err := app.SendClaudeMessage(projectPath, session.ProviderSessionID, "hello again"); err != nil {
		t.Fatalf("SendClaudeMessage with provider session id failed: %v", err)
	}
}

func TestGetProviderSessionOutputAndStopProviderSession(t *testing.T) {
	app := newGeminiTestApp(t)
	sessionID, err := app.StartProviderSession("gemini", t.TempDir(), "hello", "", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		output, err := app.GetProviderSessionOutput(sessionID)
		return err == nil && output != ""
	})

	output, err := app.GetProviderSessionOutput(sessionID)
	if err != nil {
		t.Fatalf("GetProviderSessionOutput failed: %v", err)
	}
	if output == "" {
		t.Fatal("expected provider output to be captured")
	}

	if err := app.StopProviderSession(sessionID); err != nil {
		t.Fatalf("StopProviderSession failed: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 0
	})
}

func TestSendProviderSessionMessage_RestartsGeminiSession(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	firstID, err := app.StartProviderSession("gemini", projectPath, "hello", "", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 1
	})

	if err := app.StopProviderSession(firstID); err != nil {
		t.Fatalf("StopProviderSession failed: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 0
	})

	nextID, err := app.SendProviderSessionMessage("gemini", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendProviderSessionMessage failed: %v", err)
	}
	// Same session ID — unified runtime reuses the session with resume
	if nextID != firstID {
		t.Fatalf("expected same session id on resume, got %q vs %q", firstID, nextID)
	}

	waitUntil(t, 2*time.Second, func() bool {
		sessions := app.ListRunningProviderSessions()
		return len(sessions) == 1 && sessions[0].SessionID == nextID
	})

	_ = app.StopProviderSession(nextID)
}

func TestSendProviderSessionMessage_PreservesGeminiConfigOnRestart(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	firstID, err := app.StartProviderSession("gemini", projectPath, "hello", "gemini-2.5-pro", "gemini-api", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 1
	})

	if err := app.StopProviderSession(firstID); err != nil {
		t.Fatalf("StopProviderSession failed: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 0
	})

	nextID, err := app.SendProviderSessionMessage("gemini", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendProviderSessionMessage failed: %v", err)
	}
	defer func() { _ = app.StopProviderSession(nextID) }()

	waitUntil(t, 2*time.Second, func() bool {
		sessions := app.ListRunningProviderSessions()
		return len(sessions) == 1 && sessions[0].SessionID == nextID
	})

	model, providerAPIID, _ := runningSessionConfig(t, app.providerManager, nextID)
	if model != "gemini-2.5-pro" {
		t.Fatalf("expected restarted model to be preserved, got %q", model)
	}
	if providerAPIID != "gemini-api" {
		t.Fatalf("expected restarted provider api id to be preserved, got %q", providerAPIID)
	}
}

func TestSendProviderSessionMessage_PreservesCodexConfigOnRestart(t *testing.T) {
	app := newCodexTestApp(t)
	projectPath := t.TempDir()

	firstID, err := app.StartProviderSession("codex", projectPath, "hello", "gpt-5.5", "codex-api", "medium")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}

	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 1
	})

	if err := app.StopProviderSession(firstID); err != nil {
		t.Fatalf("StopProviderSession failed: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		return len(app.ListRunningProviderSessions()) == 0
	})

	nextID, err := app.SendProviderSessionMessage("codex", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendProviderSessionMessage failed: %v", err)
	}
	defer func() { _ = app.StopProviderSession(nextID) }()

	waitUntil(t, 2*time.Second, func() bool {
		sessions := app.ListRunningProviderSessions()
		return len(sessions) == 1 && sessions[0].SessionID == nextID
	})

	model, providerAPIID, reasoningEffort := runningSessionConfig(t, app.providerManager, nextID)
	if model != "gpt-5.5" {
		t.Fatalf("expected restarted model to be preserved, got %q", model)
	}
	if providerAPIID != "codex-api" {
		t.Fatalf("expected restarted provider api id to be preserved, got %q", providerAPIID)
	}
	if reasoningEffort != "medium" {
		t.Fatalf("expected restarted reasoning effort to be preserved, got %q", reasoningEffort)
	}
}

func writeFakePiRPCBinary(t *testing.T, logPath string) string {
	t.Helper()

	if runtime.GOOS == "windows" {
		binPath := filepath.Join(t.TempDir(), "fake-pi.cmd")
		script := "@echo off\r\n" +
			"echo {\"id\":\"startup\",\"type\":\"response\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"provider-pi-1\",\"sessionFile\":\"pi.jsonl\"}}\r\n" +
			":loop\r\n" +
			"set /p line=\r\n" +
			"if errorlevel 1 goto end\r\n" +
			"echo %line%>>\"" + logPath + "\"\r\n" +
			"echo {\"id\":\"prompt\",\"type\":\"response\",\"command\":\"prompt\",\"success\":true,\"data\":{\"sessionId\":\"provider-pi-1\",\"sessionFile\":\"pi.jsonl\"}}\r\n" +
			"echo {\"type\":\"message_update\",\"delta\":\"pi says hi\"}\r\n" +
			"echo {\"type\":\"agent_end\",\"success\":true}\r\n" +
			"goto loop\r\n" +
			":end\r\n"
		if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		return binPath
	}

	binPath := filepath.Join(t.TempDir(), "fake-pi.sh")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' '{\"id\":\"startup\",\"type\":\"response\",\"command\":\"get_state\",\"success\":true,\"data\":{\"sessionId\":\"provider-pi-1\",\"sessionFile\":\"pi.jsonl\"}}'\n" +
		"while IFS= read -r line; do\n" +
		"  printf '%s\\n' \"$line\" >> '" + logPath + "'\n" +
		"  printf '%s\\n' '{\"id\":\"prompt\",\"type\":\"response\",\"command\":\"prompt\",\"success\":true,\"data\":{\"sessionId\":\"provider-pi-1\",\"sessionFile\":\"pi.jsonl\"}}'\n" +
		"  printf '%s\\n' '{\"type\":\"message_update\",\"delta\":\"pi says hi\"}'\n" +
		"  printf '%s\\n' '{\"type\":\"agent_end\",\"success\":true}'\n" +
		"done\n"
	if err := os.WriteFile(binPath, []byte(script), 0755); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	return binPath
}

func readPiCommands(t *testing.T, logPath string) []map[string]interface{} {
	t.Helper()

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var commands []map[string]interface{}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var cmd map[string]interface{}
		if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &cmd); err != nil {
			t.Fatalf("invalid JSON command %q: %v", line, err)
		}
		commands = append(commands, cmd)
	}
	return commands
}

func TestStartProviderSessionPiWritesInitialPrompt(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "pi-commands.jsonl")
	app.providerManager.SetBinaryPath("pi", writeFakePiRPCBinary(t, logPath))

	sessionID, err := app.StartProviderSession("pi", projectPath, "hello pi", "anthropic/claude-sonnet-4-20250514", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	waitUntil(t, 2*time.Second, func() bool {
		if _, err := os.Stat(logPath); err != nil {
			return false
		}
		return len(readPiCommands(t, logPath)) >= 1
	})

	commands := readPiCommands(t, logPath)
	if commands[0]["type"] != "prompt" || commands[0]["message"] != "hello pi" {
		t.Fatalf("initial command = %#v, want prompt hello pi", commands[0])
	}
	if _, ok := commands[0]["streamingBehavior"]; ok {
		t.Fatalf("initial prompt should not include streamingBehavior: %#v", commands[0])
	}

}

func TestSendProviderSessionMessagePiReusesProcessWithFollowUp(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "pi-commands.jsonl")
	app.providerManager.SetBinaryPath("pi", writeFakePiRPCBinary(t, logPath))

	sessionID, err := app.StartProviderSession("pi", projectPath, "hello pi", "anthropic/claude-sonnet-4-20250514", "", "")
	if err != nil {
		t.Fatalf("StartProviderSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	waitUntil(t, 2*time.Second, func() bool {
		return len(readPiCommandsIfExists(t, logPath)) >= 1
	})
	firstPID := app.providerManager.GetSession(sessionID).PID

	nextID, err := app.SendProviderSessionMessage("pi", projectPath, "provider-pi-1", "again")
	if err != nil {
		t.Fatalf("SendProviderSessionMessage failed: %v", err)
	}
	if nextID != sessionID {
		t.Fatalf("expected SendProviderSessionMessage to resolve runtime id %q, got %q", sessionID, nextID)
	}

	waitUntil(t, 2*time.Second, func() bool {
		return len(readPiCommandsIfExists(t, logPath)) >= 2
	})

	status := app.providerManager.GetSession(sessionID)
	if status == nil {
		t.Fatal("expected running Pi session")
	}
	if status.ProviderID != "pi" {
		t.Fatalf("provider = %q, want pi", status.ProviderID)
	}
	if status.PID != firstPID {
		t.Fatalf("expected follow-up to reuse process pid %d, got %d", firstPID, status.PID)
	}

	commands := readPiCommands(t, logPath)
	followUp := commands[1]
	if followUp["type"] != "prompt" || followUp["message"] != "again" {
		t.Fatalf("follow-up command = %#v, want prompt again", followUp)
	}
	if followUp["streamingBehavior"] != "followUp" {
		t.Fatalf("follow-up streamingBehavior = %#v, want followUp", followUp["streamingBehavior"])
	}

	output, err := app.GetProviderSessionOutput(sessionID)
	if err != nil {
		t.Fatalf("GetProviderSessionOutput failed: %v", err)
	}
	if !strings.Contains(output, "pi says hi") {
		t.Fatalf("expected Pi stdout in output, got %q", output)
	}
}

func readPiCommandsIfExists(t *testing.T, logPath string) []map[string]interface{} {
	t.Helper()
	if _, err := os.Stat(logPath); err != nil {
		return nil
	}
	return readPiCommands(t, logPath)
}
