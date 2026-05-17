package codex

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSessionConfigApplyProviderApiEnvOverridesCodexCredentials(t *testing.T) {
	env := []string{
		"OPENAI_API_KEY=old-openai",
		"CRS_OAI_KEY=old-crs",
		"OPENAI_BASE_URL=https://old.example/v1",
	}
	config := SessionConfig{
		AuthToken: "new-token",
		BaseURL:   "https://api.example/v1",
	}

	got := config.applyProviderApiEnv(env)

	assertEnvValue(t, got, "OPENAI_API_KEY", "new-token")
	assertEnvValue(t, got, "CRS_OAI_KEY", "new-token")
	assertEnvValue(t, got, "OPENAI_BASE_URL", "https://api.example/v1")
}

func TestSessionConfigBuildArgsIncludesReasoningEffort(t *testing.T) {
	config := SessionConfig{
		ProjectPath:     `E:\bit_master\ropcode`,
		Prompt:          "hello",
		Model:           "gpt-5.5",
		ReasoningEffort: "xhigh",
	}

	got := config.buildArgs()

	assertContainsSequence(t, got, "-m", "gpt-5.5")
	assertContainsSequence(t, got, "-c", `model_reasoning_effort="xhigh"`)
	assertContainsSequence(t, got, "--", "hello")
}

func TestEnhanceEnvForProductionAddsWindowsNodePaths(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only PATH enhancement")
	}

	root := t.TempDir()
	nodeDir := filepath.Join(root, "nodejs")
	npmDir := filepath.Join(root, "npm", "npm")
	if err := os.MkdirAll(nodeDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(npmDir, 0755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("ROPCODE_TEST_NODE_DIR", nodeDir)
	t.Setenv("ROPCODE_TEST_NPM_DIR", npmDir)

	got := enhanceEnvForProduction()
	pathValue := envValue(got, "PATH")
	parts := strings.Split(pathValue, string(os.PathListSeparator))

	nodeIndex := indexOf(parts, nodeDir)
	npmIndex := indexOf(parts, npmDir)
	originalIndex := indexOf(parts, filepath.SplitList(os.Getenv("PATH"))[0])
	if nodeIndex < 0 || npmIndex < 0 {
		t.Fatalf("expected node/npm dirs in PATH, got %q", pathValue)
	}
	if originalIndex >= 0 && (nodeIndex > originalIndex || npmIndex > originalIndex) {
		t.Fatalf("expected node/npm dirs before original PATH, got %q", pathValue)
	}
}

func assertContainsSequence(t *testing.T, values []string, want ...string) {
	t.Helper()

	for i := 0; i <= len(values)-len(want); i++ {
		matched := true
		for offset, value := range want {
			if values[i+offset] != value {
				matched = false
				break
			}
		}
		if matched {
			return
		}
	}

	t.Fatalf("expected args to contain sequence %q, got %q", want, values)
}

func assertEnvValue(t *testing.T, env []string, key, want string) {
	t.Helper()

	prefix := key + "="
	for _, entry := range env {
		if len(entry) >= len(prefix) && entry[:len(prefix)] == prefix {
			if got := entry[len(prefix):]; got != want {
				t.Fatalf("%s = %q, want %q", key, got, want)
			}
			return
		}
	}

	t.Fatalf("%s was not set in environment", key)
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

func indexOf(values []string, want string) int {
	for i, value := range values {
		if value == want {
			return i
		}
	}
	return -1
}
