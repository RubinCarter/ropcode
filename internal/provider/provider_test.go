package provider

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestDiscoverBinary_LookPath(t *testing.T) {
	// "ls" or "cmd" should always be findable
	var name string
	if runtime.GOOS == "windows" {
		name = "cmd"
	} else {
		name = "ls"
	}

	path, err := DiscoverBinary(name, nil)
	if err != nil {
		t.Fatalf("expected to find %q, got error: %v", name, err)
	}
	if path == "" {
		t.Fatal("expected non-empty path")
	}
}

func TestDiscoverBinary_NotFound(t *testing.T) {
	_, err := DiscoverBinary("nonexistent-binary-xyz-12345", nil)
	if err == nil {
		t.Fatal("expected error for nonexistent binary")
	}
}

func TestDiscoverBinary_ExtraCandidates(t *testing.T) {
	// Create a temp executable
	tmp := t.TempDir()
	binPath := tmp + "/test-bin"
	if runtime.GOOS == "windows" {
		binPath += ".exe"
	}
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatal(err)
	}

	path, err := DiscoverBinary("test-bin", []string{binPath})
	if err != nil {
		t.Fatalf("expected to find binary via extra candidates: %v", err)
	}
	if path != binPath {
		t.Fatalf("expected %q, got %q", binPath, path)
	}
}

func TestBuildProcessEnv_InheritsCurrentEnv(t *testing.T) {
	env := BuildProcessEnv(nil)
	found := false
	for _, e := range env {
		if strings.HasPrefix(e, "HOME=") || strings.HasPrefix(e, "USERPROFILE=") {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected HOME or USERPROFILE in env")
	}
}

func TestBuildProcessEnv_AppliesDriverVars(t *testing.T) {
	env := BuildProcessEnv(map[string]string{
		"TEST_PROVIDER_KEY": "test-value-123",
	})

	found := false
	for _, e := range env {
		if e == "TEST_PROVIDER_KEY=test-value-123" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected TEST_PROVIDER_KEY in env")
	}
}

func TestBuildProcessEnv_OverridesExistingVar(t *testing.T) {
	os.Setenv("TEST_OVERRIDE_VAR", "old-value")
	defer os.Unsetenv("TEST_OVERRIDE_VAR")

	env := BuildProcessEnv(map[string]string{
		"TEST_OVERRIDE_VAR": "new-value",
	})

	for _, e := range env {
		if e == "TEST_OVERRIDE_VAR=new-value" {
			return
		}
		if e == "TEST_OVERRIDE_VAR=old-value" {
			t.Fatal("expected override, got old value")
		}
	}
	t.Fatal("TEST_OVERRIDE_VAR not found in env")
}

func TestEnhancePATH_AddsCommonPaths(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATH enhancement is unix-only")
	}

	env := []string{"PATH=/usr/bin"}
	env = enhancePATH(env)

	pathVal := ""
	for _, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			pathVal = strings.TrimPrefix(e, "PATH=")
			break
		}
	}

	if !strings.Contains(pathVal, "/opt/homebrew/bin") {
		t.Error("expected /opt/homebrew/bin in PATH")
	}
	if !strings.Contains(pathVal, "/usr/local/bin") {
		t.Error("expected /usr/local/bin in PATH")
	}
}

func TestEnhancePATH_NoDuplicates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATH enhancement is unix-only")
	}

	env := []string{"PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin"}
	env = enhancePATH(env)

	pathVal := ""
	for _, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			pathVal = strings.TrimPrefix(e, "PATH=")
			break
		}
	}

	parts := strings.Split(pathVal, ":")
	seen := make(map[string]int)
	for _, p := range parts {
		seen[p]++
		if seen[p] > 1 {
			t.Errorf("duplicate path entry: %s", p)
		}
	}
}
