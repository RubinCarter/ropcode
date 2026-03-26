package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ropcode/internal/gemini"
)

func writeFakeProviderBinary(t *testing.T) string {
	t.Helper()

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
	mgr := gemini.NewSessionManager(context.Background(), nil)
	mgr.SetBinaryPath(writeFakeProviderBinary(t))
	return &App{geminiManager: mgr}
}

func TestListRunningProviderSessions_IncludesProviderMetadata(t *testing.T) {
	app := newGeminiTestApp(t)
	projectPath := t.TempDir()

	sessionID, err := app.StartProviderSession("gemini", projectPath, "hello", "gemini-test", "")
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

func TestGetProviderSessionOutputAndStopProviderSession(t *testing.T) {
	app := newGeminiTestApp(t)
	sessionID, err := app.StartProviderSession("gemini", t.TempDir(), "hello", "", "")
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

	firstID, err := app.StartProviderSession("gemini", projectPath, "hello", "", "")
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
	if nextID == firstID {
		t.Fatalf("expected restarted gemini session id to change, got %q", nextID)
	}

	waitUntil(t, 2*time.Second, func() bool {
		sessions := app.ListRunningProviderSessions()
		return len(sessions) == 1 && sessions[0].SessionID == nextID
	})

	_ = app.StopProviderSession(nextID)
}
