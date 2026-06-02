package codex

import (
	"slices"
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
