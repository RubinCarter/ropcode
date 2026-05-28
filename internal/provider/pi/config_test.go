package pi

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadLocalConfigFromDirReadsConfiguredProvidersAndDefaults(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{
  "defaultProvider": "openai",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "medium"
}`), 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(`{
  "deepseek": {"type": "api_key", "key": "sk-deepseek"},
  "openai": {"type": "api_key", "key": ""}
}`), 0o600); err != nil {
		t.Fatalf("write auth: %v", err)
	}

	cfg, err := LoadLocalConfigFromDir(dir)
	if err != nil {
		t.Fatalf("LoadLocalConfigFromDir failed: %v", err)
	}

	if cfg.DefaultModelID() != "openai/gpt-5.5" {
		t.Fatalf("DefaultModelID = %q, want openai/gpt-5.5", cfg.DefaultModelID())
	}
	if !cfg.HasAuthProvider("deepseek") {
		t.Fatalf("expected deepseek to be recognized as configured: %#v", cfg.AuthProviders)
	}
	if cfg.HasAuthProvider("openai") {
		t.Fatalf("openai has an empty key and should not be recognized: %#v", cfg.AuthProviders)
	}
}

func TestProviderAPIConfigsExposeConfiguredPiUpstreams(t *testing.T) {
	cfg := LocalConfig{
		AuthProviders:   []string{"deepseek"},
		DefaultProvider: "openai",
		DefaultModel:    "gpt-5.5",
	}

	configs := cfg.ProviderAPIConfigs(time.Date(2026, 5, 28, 0, 0, 0, 0, time.UTC))
	if len(configs) != 1 {
		t.Fatalf("expected one local provider API config, got %#v", configs)
	}
	if configs[0].ID != "pi-local-deepseek" || configs[0].ProviderID != "pi" || configs[0].Name != "Pi · DeepSeek" {
		t.Fatalf("unexpected local provider API config: %#v", configs[0])
	}
	if !configs[0].IsDefault {
		t.Fatalf("single configured upstream should become Pi default: %#v", configs[0])
	}
	if configs[0].AuthToken != "" {
		t.Fatal("local Pi provider API config must not duplicate auth.json tokens into Ropcode")
	}
}
