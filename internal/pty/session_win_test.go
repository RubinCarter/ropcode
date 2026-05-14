//go:build windows

package pty

import (
	"strings"
	"testing"
)

func TestDetectDefaultShellOnWindowsDoesNotUseUnixFallback(t *testing.T) {
	shell := detectDefaultShell()
	normalized := strings.ToLower(strings.ReplaceAll(shell, "\\", "/"))

	if strings.HasSuffix(normalized, "/bin/sh") || shell == "/bin/sh" {
		t.Fatalf("expected a Windows shell, got %q", shell)
	}
	if !strings.Contains(normalized, "cmd") && !strings.Contains(normalized, "powershell") && !strings.Contains(normalized, "pwsh") {
		t.Fatalf("expected cmd or PowerShell shell, got %q", shell)
	}
}

func TestNewSessionNormalizesWindowsCwdWithLeadingSlash(t *testing.T) {
	session, err := NewSession("test-cwd", `/E:\bit_master\ropcode`, 24, 80, "cmd.exe")
	if err != nil {
		t.Fatalf("NewSession failed: %v", err)
	}

	if session.Cwd != `E:\bit_master\ropcode` {
		t.Fatalf("expected normalized cwd, got %q", session.Cwd)
	}
}
