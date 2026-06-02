package codex

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"ropcode/internal/provider"
)

func TestDriverBuildInteractiveArgsUsesUnrestrictedSandboxConfig(t *testing.T) {
	args := (&Driver{}).BuildArgs(provider.SessionConfig{
		Interactive: true,
		Model:       "gpt-5.2",
	})

	assertArgPair(t, args, "-c", `sandbox_mode="danger-full-access"`)
	assertArgPair(t, args, "-c", `approval_policy="never"`)
	assertArgPair(t, args, "-c", "sandbox_danger_full_access.network_access=true")
	if slices.Contains(args, "--sandbox") {
		t.Fatalf("app-server does not expose --sandbox; got args %#v", args)
	}
}

func TestDriverBuildBatchArgsUsesDangerFullAccessSandbox(t *testing.T) {
	args := (&Driver{}).BuildArgs(provider.SessionConfig{
		Prompt: "hello",
	})

	assertArgPair(t, args, "--sandbox", "danger-full-access")
	assertArgPair(t, args, "-c", `approval_policy="never"`)
	assertArgPair(t, args, "-c", "sandbox_danger_full_access.network_access=true")
	if containsArgPair(args, "-c", `sandbox_mode="danger-full-access"`) {
		t.Fatalf("exec already receives --sandbox danger-full-access; got duplicate config in %#v", args)
	}
}

func TestExpandAtFileMentionsInlinesProjectTextFiles(t *testing.T) {
	projectPath := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectPath, "notes.txt"), []byte("hello from file\n"), 0644); err != nil {
		t.Fatal(err)
	}

	got := expandAtFileMentions("read @notes.txt", projectPath)

	if !strings.Contains(got, "File: "+filepath.Join(projectPath, "notes.txt")) {
		t.Fatalf("expected resolved file path in context, got %q", got)
	}
	if !strings.Contains(got, "hello from file") {
		t.Fatalf("expected file content in context, got %q", got)
	}
}

func TestExpandAtFileMentionsHandlesQuotedPaths(t *testing.T) {
	projectPath := t.TempDir()
	name := "file with spaces.md"
	if err := os.WriteFile(filepath.Join(projectPath, name), []byte("# title\n"), 0644); err != nil {
		t.Fatal(err)
	}

	got := expandAtFileMentions(`read @"file with spaces.md"`, projectPath)

	if !strings.Contains(got, "# title") {
		t.Fatalf("expected quoted file content in context, got %q", got)
	}
}

func TestExpandAtFileMentionsDoesNotInlineBinaryFiles(t *testing.T) {
	projectPath := t.TempDir()
	path := filepath.Join(projectPath, "image.png")
	if err := os.WriteFile(path, []byte{0x89, 'P', 'N', 'G', 0x00}, 0644); err != nil {
		t.Fatal(err)
	}

	got := expandAtFileMentions("inspect @image.png", projectPath)

	if !strings.Contains(got, "binary or image attachment") {
		t.Fatalf("expected binary attachment note, got %q", got)
	}
	if strings.Contains(got, string([]byte{0x89, 'P', 'N', 'G', 0x00})) {
		t.Fatalf("binary content should not be inlined, got %q", got)
	}
}

func assertArgPair(t *testing.T, args []string, key, value string) {
	t.Helper()
	if !containsArgPair(args, key, value) {
		t.Fatalf("missing arg pair %q %q in %#v", key, value, args)
	}
}

func containsArgPair(args []string, key, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == key && args[i+1] == value {
			return true
		}
	}
	return false
}
