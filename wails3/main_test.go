package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestParseWSPort(t *testing.T) {
	port, ok := parseWSPort("log line\nWS_PORT:5180\n")
	if !ok {
		t.Fatal("expected WS_PORT to be parsed")
	}
	if port != 5180 {
		t.Fatalf("expected port 5180, got %d", port)
	}
}

func TestRuntimeScriptUsesShellFetchBridge(t *testing.T) {
	shell := &shell{serverPort: 5173, authKey: "secret"}

	script := shell.runtimeScript()
	for _, needle := range []string{
		"window.__ROPCODE_WS_PORT__ = 5173",
		"window.__ROPCODE_AUTH_KEY__ = \"secret\"",
		"fetch('/ropcode-shell/",
		"minimizeWindow: () => call('minimize-window')",
	} {
		if !strings.Contains(script, needle) {
			t.Fatalf("runtime script missing %q:\n%s", needle, script)
		}
	}
	if strings.Contains(script, "window.go.main") {
		t.Fatalf("runtime script should not depend on Wails v2 bindings:\n%s", script)
	}
}

func TestShellBridgeWriteRendererLog(t *testing.T) {
	logger, cleanup, err := createRendererLogger(t.TempDir())
	if err != nil {
		t.Fatalf("createRendererLogger failed: %v", err)
	}
	defer cleanup()

	shell := &shell{rendererLogger: logger}

	req := httptest.NewRequest(http.MethodPost, "/ropcode-shell/write-renderer-log", strings.NewReader(`{"args":["info","test",["ok"]]}`))
	rec := httptest.NewRecorder()
	shell.handleShellBridge(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d with body %q", rec.Code, rec.Body.String())
	}

	cleanup()
	content, err := os.ReadFile(logger.path)
	if err != nil {
		t.Fatalf("read renderer log: %v", err)
	}
	if !strings.Contains(string(content), "ok") {
		t.Fatalf("expected renderer bridge log line, got %q", string(content))
	}
}

func TestShellBridgeWriteRendererLogAllowsMissingLogger(t *testing.T) {
	shell := &shell{}

	req := httptest.NewRequest(http.MethodPost, "/ropcode-shell/write-renderer-log", strings.NewReader(`{"args":["info","test",["ok"]]}`))
	rec := httptest.NewRecorder()
	shell.handleShellBridge(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d with body %q", rec.Code, rec.Body.String())
	}
}

func TestProxyServerRequestAllowsCurrentStreamWebSocketPaths(t *testing.T) {
	paths := []string{
		"/ws/stream/session/claude%3Aruntime-1",
		"/ws/stream/bulk/pty/terminal-1",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			shell := &shell{}
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			if !shell.proxyServerRequest(rec, req) {
				t.Fatalf("expected %s to be handled by server proxy", path)
			}
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected server-not-ready status, got %d", rec.Code)
			}
		})
	}
}

func TestProxyServerRequestRejectsOldStreamWebSocketPaths(t *testing.T) {
	paths := []string{
		"/ws/session-stream/claude%3Aruntime-1",
		"/ws/bulk-stream/pty/terminal-1",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			shell := &shell{}
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			if shell.proxyServerRequest(rec, req) {
				t.Fatalf("expected old stream path %s to be rejected by server proxy", path)
			}
		})
	}
}
