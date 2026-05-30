package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
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

func ensureUserSessionForTest(t *testing.T, app *App, providerName, projectPath, prompt, model, providerApiID, reasoningEffort string, resumeSessionID ...string) (string, error) {
	t.Helper()
	config := app.providerSessionConfig(providerName, projectPath, model, providerApiID, reasoningEffort)
	config.Prompt = prompt
	if len(resumeSessionID) > 0 && resumeSessionID[0] != "" {
		config.ResumeSessionID = resumeSessionID[0]
		config.Resume = true
	}
	return app.providerManager.EnsureUserSession(providerName, config)
}

func TestListRunningProviderSessions_IncludesProviderMetadata(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	sessionID, err := ensureUserSessionForTest(t, app, "gemini", projectPath, "hello", "gemini-test", "", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

func TestEnsureUserSessionUsesDeepSeekDefaultProviderApiConfig(t *testing.T) {
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

	sessionID, err := ensureUserSessionForTest(t, app, "deepseek", projectPath, "hello", "deepseek-v4-pro", "", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
	}
	defer app.StopProviderSession(sessionID)

	_, gotProviderApiID, _ := runningSessionConfig(t, app.providerManager, sessionID)
	if gotProviderApiID != apiCfg.ID {
		t.Fatalf("expected DeepSeek default providerApiID %q, got %q", apiCfg.ID, gotProviderApiID)
	}
}

func TestEnsureUserSessionWithResumeUsesDeepSeekDefaultProviderApiConfig(t *testing.T) {
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

	sessionID, err := ensureUserSessionForTest(t, app, "deepseek", projectPath, "hello again", "deepseek-v4-pro", "", "", "upstream-session-id")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

func TestSendUserMessageAcceptsProviderSessionIDForRunningSession(t *testing.T) {
	app := newGeminiTestApp(t)
	app.providerManager.SetBinaryPath("claude", writeFakeClaudeInteractiveBinary(t))
	projectPath := t.TempDir()

	sessionID, err := ensureUserSessionForTest(t, app, "claude", projectPath, "", "sonnet", "", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

	if _, err := app.providerManager.SendUserMessage("claude", projectPath, session.ProviderSessionID, "hello again"); err != nil {
		t.Fatalf("SendUserMessage with provider session id failed: %v", err)
	}
}

func TestGetProviderSessionOutputAndStopProviderSession(t *testing.T) {
	app := newGeminiTestApp(t)
	sessionID, err := ensureUserSessionForTest(t, app, "gemini", t.TempDir(), "hello", "", "", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

func TestSendUserMessage_RestartsGeminiSession(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	firstID, err := ensureUserSessionForTest(t, app, "gemini", projectPath, "hello", "", "", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

	nextID, err := app.providerManager.SendUserMessage("gemini", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendUserMessage failed: %v", err)
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

func TestSendUserMessage_PreservesGeminiConfigOnRestart(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	firstID, err := ensureUserSessionForTest(t, app, "gemini", projectPath, "hello", "gemini-2.5-pro", "gemini-api", "")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

	nextID, err := app.providerManager.SendUserMessage("gemini", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendUserMessage failed: %v", err)
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

func TestSendUserMessage_PreservesCodexConfigOnRestart(t *testing.T) {
	app := newCodexTestApp(t)
	projectPath := t.TempDir()

	firstID, err := ensureUserSessionForTest(t, app, "codex", projectPath, "hello", "gpt-5.5", "codex-api", "medium")
	if err != nil {
		t.Fatalf("EnsureUserSession failed: %v", err)
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

	nextID, err := app.providerManager.SendUserMessage("codex", projectPath, firstID, "follow up")
	if err != nil {
		t.Fatalf("SendUserMessage failed: %v", err)
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
