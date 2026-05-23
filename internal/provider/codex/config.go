package codex

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ActiveProvider describes the model provider Codex CLI is currently
// configured to talk to. It mirrors what the CLI itself reads out of
// ~/.codex/config.toml + ~/.codex/auth.json.
type ActiveProvider struct {
	Name      string
	BaseURL   string
	EnvKey    string
	AuthToken string
}

// LoadActiveProvider reads ~/.codex/config.toml and ~/.codex/auth.json to
// figure out which provider is active and resolves its credentials. Returns
// (nil, nil) when the codex config file doesn't exist.
func LoadActiveProvider() (*ActiveProvider, error) {
	codexDir, err := codexDir()
	if err != nil {
		return nil, err
	}
	return loadActiveProviderFrom(codexDir)
}

func codexDir() (string, error) {
	if env := strings.TrimSpace(os.Getenv("CODEX_HOME")); env != "" {
		return env, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}

func loadActiveProviderFrom(codexDir string) (*ActiveProvider, error) {
	cfgPath := filepath.Join(codexDir, "config.toml")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read codex config: %w", err)
	}

	parsed := parseCodexConfig(string(data))

	providerName := parsed.modelProvider
	if providerName == "" {
		providerName = "openai"
	}
	provider, ok := parsed.providers[providerName]
	if !ok {
		for name, p := range parsed.providers {
			if strings.EqualFold(name, providerName) {
				provider = p
				ok = true
				break
			}
		}
	}
	if !ok {
		return nil, fmt.Errorf("codex config selects model_provider %q but no [model_providers.%s] section was found", providerName, providerName)
	}

	envKey := strings.TrimSpace(provider.envKey)
	authToken := resolveCodexAuth(codexDir, envKey)

	return &ActiveProvider{
		Name:      providerName,
		BaseURL:   strings.TrimSpace(provider.baseURL),
		EnvKey:    envKey,
		AuthToken: authToken,
	}, nil
}

func resolveCodexAuth(codexDir, envKey string) string {
	if envKey != "" {
		if v := os.Getenv(envKey); v != "" {
			return v
		}
	}
	if data, err := os.ReadFile(filepath.Join(codexDir, "auth.json")); err == nil {
		var auth map[string]string
		if json.Unmarshal(data, &auth) == nil {
			lookup := envKey
			if lookup == "" {
				lookup = "OPENAI_API_KEY"
			}
			if v := strings.TrimSpace(auth[lookup]); v != "" {
				return v
			}
		}
	}
	if envKey == "" {
		return os.Getenv("OPENAI_API_KEY")
	}
	return ""
}

type codexProviderEntry struct {
	baseURL string
	envKey  string
}

type codexConfig struct {
	modelProvider string
	providers     map[string]codexProviderEntry
}

func parseCodexConfig(input string) codexConfig {
	cfg := codexConfig{providers: map[string]codexProviderEntry{}}
	currentSection := ""
	for _, raw := range strings.Split(input, "\n") {
		line := stripCodexComment(raw)
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			if strings.HasPrefix(line, "[[") {
				currentSection = ""
				continue
			}
			currentSection = strings.TrimSpace(line[1 : len(line)-1])
			continue
		}
		key, value, ok := splitCodexAssignment(line)
		if !ok {
			continue
		}
		switch {
		case currentSection == "" && key == "model_provider":
			cfg.modelProvider = value
		case strings.HasPrefix(currentSection, "model_providers."):
			providerName := strings.TrimPrefix(currentSection, "model_providers.")
			providerName = strings.Trim(providerName, `"'`)
			entry := cfg.providers[providerName]
			switch key {
			case "base_url":
				entry.baseURL = value
			case "env_key":
				entry.envKey = value
			}
			cfg.providers[providerName] = entry
		}
	}
	return cfg
}

func stripCodexComment(line string) string {
	inSingle, inDouble := false, false
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '\'' && !inDouble:
			inSingle = !inSingle
		case c == '"' && !inSingle:
			inDouble = !inDouble
		case c == '#' && !inSingle && !inDouble:
			return line[:i]
		}
	}
	return line
}

func splitCodexAssignment(line string) (key, value string, ok bool) {
	idx := strings.Index(line, "=")
	if idx < 0 {
		return "", "", false
	}
	key = strings.TrimSpace(line[:idx])
	rawVal := strings.TrimSpace(line[idx+1:])
	if rawVal == "" {
		return key, "", true
	}
	if rawVal[0] == '"' || rawVal[0] == '\'' {
		quote := rawVal[0]
		end := strings.IndexByte(rawVal[1:], quote)
		if end >= 0 {
			return key, rawVal[1 : 1+end], true
		}
		return key, strings.Trim(rawVal, `"'`), true
	}
	return key, rawVal, true
}
