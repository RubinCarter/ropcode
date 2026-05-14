package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildReleaseScriptBuildsCLIForCurrentOS(t *testing.T) {
	scriptPath := filepath.Join("scripts", "build-electron.sh")
	content, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")

	for _, want := range []string{
		"go build -o bin/darwin/arm64/ropcode ./cmd/ropcode",
		"go build -o bin/darwin/x64/ropcode ./cmd/ropcode",
		"go build -o bin/linux/x64/ropcode ./cmd/ropcode",
		"go build -o bin/win32/x64/ropcode.exe ./cmd/ropcode",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected build-electron.sh to include %q", want)
		}
	}
}

func TestElectronBuilderPackagesCLIResource(t *testing.T) {
	configPath := "electron-builder.yml"
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")

	for _, want := range []string{
		"from: bin/darwin/${arch}/ropcode\n",
		"to: bin/ropcode\n",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected electron-builder.yml to include %q", strings.TrimSpace(want))
		}
	}
}

func TestElectronBuilderPackagesRuntimeAssets(t *testing.T) {
	configPath := "electron-builder.yml"
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	text := strings.ReplaceAll(string(content), "\r\n", "\n")

	for _, want := range []string{
		"from: assets\n",
		"to: assets\n",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected electron-builder.yml to include %q", strings.TrimSpace(want))
		}
	}
}

func TestBuildReleaseScriptKeepsWindowsExeNamesInPackagedResources(t *testing.T) {
	scriptPath := filepath.Join("scripts", "build-electron.sh")
	content, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	text := string(content)

	for _, want := range []string{
		`SERVER_RESOURCE="bin/ropcode-server.exe"`,
		`CLI_RESOURCE="bin/ropcode.exe"`,
		`s|to: bin/ropcode-server|to: $SERVER_RESOURCE|`,
		`s|to: bin/ropcode$|to: $CLI_RESOURCE|`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected build-electron.sh to include %q", want)
		}
	}
}

func TestDevScriptBuildsCLI(t *testing.T) {
	content, err := os.ReadFile("package.json")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	text := string(content)

	if !strings.Contains(text, "go build -o bin/ropcode ./cmd/ropcode") {
		t.Fatalf("expected package.json dev-related build script to compile cmd/ropcode")
	}
}
