//go:build wails

package main

import (
	"context"
	"testing"

	"ropcode/internal/websocket"
)

type wailsRuntimeTestApp struct{}

func (wailsRuntimeTestApp) Ping() string {
	return "pong"
}

func TestWailsRuntimeScriptUsesServerAuthKey(t *testing.T) {
	shell := &wailsShell{
		ctx:      context.Background(),
		wsServer: websocket.NewServer(wailsRuntimeTestApp{}),
	}
	shell.wsServer.SetAuthKey("")

	script := shell.runtimeScript()
	if !containsAll(script, "window.__ROPCODE_AUTH_KEY__ = \"\"", "authKey: \"\"") {
		t.Fatalf("runtime script did not expose empty auth key: %s", script)
	}
}

func containsAll(value string, needles ...string) bool {
	for _, needle := range needles {
		if !contains(value, needle) {
			return false
		}
	}
	return true
}

func contains(value, needle string) bool {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
