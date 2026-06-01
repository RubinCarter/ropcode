//go:build wails

package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type wailsRuntimeTestApp struct{}

func (wailsRuntimeTestApp) Ping() string {
	return "pong"
}

func TestWailsRuntimeScriptUsesServerAuthKey(t *testing.T) {
	shell := &wailsShell{
		ctx:     context.Background(),
		authKey: "",
	}

	script := shell.runtimeScript()
	if !containsAll(script, "window.__ROPCODE_AUTH_KEY__ = \"\"", "authKey: \"\"") {
		t.Fatalf("runtime script did not expose empty auth key: %s", script)
	}
}

func TestFindDevServerBinaryPrefersRepoBin(t *testing.T) {
	dir := t.TempDir()
	name := "ropcode-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module ropcode-test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "wails.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(binDir, name)
	if err := os.WriteFile(want, []byte{}, 0o755); err != nil {
		t.Fatal(err)
	}

	oldCwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(oldCwd)
	})

	got, ok := findDevServerBinary(name)
	if !ok {
		t.Fatal("expected dev server binary to be found")
	}
	gotInfo, err := os.Stat(got)
	if err != nil {
		t.Fatal(err)
	}
	wantInfo, err := os.Stat(want)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(gotInfo, wantInfo) {
		t.Fatalf("expected %q, got %q", want, got)
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
