// internal/codex/config_test.go
package codex

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadActiveProvider_RealCodexExample(t *testing.T) {
	dir := t.TempDir()
	writeCodexFiles(t, dir, `
model_provider = "OpenAI"
model = "gpt-5.5"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://api.rucodes.cc"
wire_api = "responses"
requires_openai_auth = true
`, `{"OPENAI_API_KEY":"sk-test"}`)

	got, err := loadActiveProviderFrom(dir)
	if err != nil {
		t.Fatalf("loadActiveProviderFrom: %v", err)
	}
	if got == nil {
		t.Fatal("expected provider, got nil")
	}
	if got.Name != "OpenAI" {
		t.Errorf("Name=%q want OpenAI", got.Name)
	}
	if got.BaseURL != "https://api.rucodes.cc" {
		t.Errorf("BaseURL=%q want https://api.rucodes.cc", got.BaseURL)
	}
	if got.AuthToken != "sk-test" {
		t.Errorf("AuthToken=%q want sk-test", got.AuthToken)
	}
}

func TestLoadActiveProvider_CustomEnvKey(t *testing.T) {
	t.Setenv("CUSTOM_KEY", "from-env")
	dir := t.TempDir()
	writeCodexFiles(t, dir, `
model_provider = "Rucodes"

[model_providers.Rucodes]
name = "Rucodes"
base_url = "https://api.rucodes.cc/v1"
env_key = "CUSTOM_KEY"
`, "")

	got, err := loadActiveProviderFrom(dir)
	if err != nil {
		t.Fatalf("loadActiveProviderFrom: %v", err)
	}
	if got.AuthToken != "from-env" {
		t.Errorf("expected env-resolved token, got %q", got.AuthToken)
	}
	if got.EnvKey != "CUSTOM_KEY" {
		t.Errorf("EnvKey=%q want CUSTOM_KEY", got.EnvKey)
	}
}

func TestLoadActiveProvider_MissingFileReturnsNil(t *testing.T) {
	got, err := loadActiveProviderFrom(t.TempDir())
	if err != nil {
		t.Fatalf("expected no error for missing config, got %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil provider for missing config, got %#v", got)
	}
}

func TestLoadActiveProvider_DefaultsToOpenAIProviderName(t *testing.T) {
	dir := t.TempDir()
	writeCodexFiles(t, dir, `
[model_providers.openai]
base_url = "https://example.com"
`, `{"OPENAI_API_KEY":"sk"}`)

	got, err := loadActiveProviderFrom(dir)
	if err != nil {
		t.Fatalf("loadActiveProviderFrom: %v", err)
	}
	if got == nil || got.BaseURL != "https://example.com" {
		t.Fatalf("expected default openai provider to resolve, got %#v", got)
	}
}

func TestLoadActiveProvider_IgnoresProjectsAndOtherSections(t *testing.T) {
	// The config.toml the user pasted earlier has many other sections
	// (mcp_servers, projects with quoted paths, tui, etc.). The parser
	// must skip those without choking on dots/slashes in section names.
	dir := t.TempDir()
	writeCodexFiles(t, dir, `
model_provider = "OpenAI"

[model_providers.OpenAI]
base_url = "https://api.rucodes.cc"

[projects."/Users/rubin/Downloads/test1"]
trust_level = "untrusted"

[projects."C:\\Users\\rubin"]
trust_level = "trusted"

[mcp_servers.pencil]
command = "/path/with#hash/in/it"
`, `{"OPENAI_API_KEY":"sk"}`)

	got, err := loadActiveProviderFrom(dir)
	if err != nil {
		t.Fatalf("loadActiveProviderFrom: %v", err)
	}
	if got == nil || got.BaseURL != "https://api.rucodes.cc" {
		t.Fatalf("expected base_url to survive surrounding sections, got %#v", got)
	}
}

func TestCodexDir_HonoursCODEX_HOME(t *testing.T) {
	want := filepath.Join(t.TempDir(), "custom-codex")
	t.Setenv("CODEX_HOME", want)
	got, err := CodexDir()
	if err != nil {
		t.Fatalf("CodexDir: %v", err)
	}
	if got != want {
		t.Fatalf("CodexDir=%q want %q", got, want)
	}
}

func TestCodexDir_FallsBackToHomeDot(t *testing.T) {
	t.Setenv("CODEX_HOME", "")
	if runtime.GOOS == "windows" {
		t.Setenv("USERPROFILE", t.TempDir())
	} else {
		t.Setenv("HOME", t.TempDir())
	}
	got, err := CodexDir()
	if err != nil {
		t.Fatalf("CodexDir: %v", err)
	}
	if filepath.Base(got) != ".codex" {
		t.Fatalf("expected .codex suffix, got %q", got)
	}
}

func writeCodexFiles(t *testing.T, dir, configTOML, authJSON string) {
	t.Helper()
	if configTOML != "" {
		if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte(configTOML), 0o600); err != nil {
			t.Fatalf("write config.toml: %v", err)
		}
	}
	if authJSON != "" {
		if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(authJSON), 0o600); err != nil {
			t.Fatalf("write auth.json: %v", err)
		}
	}
}
