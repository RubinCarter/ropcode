// internal/codex/config.go
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
	Name      string // provider table key, e.g. "OpenAI" or "Rucodes"
	BaseURL   string // base_url from [model_providers.<Name>]
	EnvKey    string // env_key (when set); empty means default OPENAI_API_KEY
	AuthToken string // resolved auth token from auth.json or env
}

// LoadActiveProvider reads ~/.codex/config.toml and ~/.codex/auth.json to
// figure out which provider is active and resolves its credentials. Returns
// (nil, nil) when the codex config file doesn't exist — callers should fall
// back to other sources in that case.
//
// The codex directory is resolved through CodexDir(), which honours
// $CODEX_HOME and otherwise uses ~/.codex on every platform (filepath.Join
// handles per-OS separators).
func LoadActiveProvider() (*ActiveProvider, error) {
	codexDir, err := CodexDir()
	if err != nil {
		return nil, err
	}
	return loadActiveProviderFrom(codexDir)
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
		providerName = "openai" // codex CLI default when not specified
	}
	provider, ok := parsed.providers[providerName]
	if !ok {
		// Try a case-insensitive lookup before giving up — TOML is case
		// sensitive but users sometimes type "openai" vs "OpenAI".
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
	// Default: codex stores OPENAI_API_KEY in ~/.codex/auth.json.
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
			if envKey == "" {
				if v := strings.TrimSpace(auth["OPENAI_API_KEY"]); v != "" {
					return v
				}
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

// parseCodexConfig is a deliberately tiny TOML reader that handles only the
// subset Codex's config.toml uses for our needs: top-level scalars and
// dotted section headers like [model_providers.OpenAI] / [projects."/some/path"].
// We don't bring in a TOML library because the surface we touch is two
// fields per active provider.
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
			// Skip array-of-tables headers ([[...]]) — Codex doesn't use them
			// for provider config, but leave the door closed defensively.
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
	// Strip `#` to end of line, but not when it appears inside a quoted string.
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
