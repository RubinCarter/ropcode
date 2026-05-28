package pi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/provider"
)

type LocalConfig struct {
	AuthProviders        []string
	DefaultProvider      string
	DefaultModel         string
	DefaultThinkingLevel string
}

type localSettings struct {
	DefaultProvider      string `json:"defaultProvider"`
	DefaultModel         string `json:"defaultModel"`
	DefaultThinkingLevel string `json:"defaultThinkingLevel"`
}

type localAuthEntry struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

func LoadLocalConfig() (LocalConfig, error) {
	piDir, err := PiDir()
	if err != nil {
		return LocalConfig{}, err
	}
	return LoadLocalConfigFromDir(piDir)
}

func LoadLocalConfigFromDir(piDir string) (LocalConfig, error) {
	var cfg LocalConfig

	settings, err := readLocalSettings(filepath.Join(piDir, "settings.json"))
	if err != nil {
		return cfg, err
	}
	cfg.DefaultProvider = strings.TrimSpace(settings.DefaultProvider)
	cfg.DefaultModel = strings.TrimSpace(settings.DefaultModel)
	cfg.DefaultThinkingLevel = strings.TrimSpace(settings.DefaultThinkingLevel)

	authProviders, err := readLocalAuthProviders(filepath.Join(piDir, "auth.json"))
	if err != nil {
		return cfg, err
	}
	cfg.AuthProviders = authProviders
	return cfg, nil
}

func readLocalSettings(path string) (localSettings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return localSettings{}, nil
		}
		return localSettings{}, err
	}
	var settings localSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return localSettings{}, fmt.Errorf("parse pi settings: %w", err)
	}
	return settings, nil
}

func readLocalAuthProviders(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var raw map[string]localAuthEntry
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse pi auth: %w", err)
	}

	providers := make([]string, 0, len(raw))
	for providerID, entry := range raw {
		providerID = strings.TrimSpace(providerID)
		if providerID == "" || strings.TrimSpace(entry.Key) == "" {
			continue
		}
		providers = append(providers, providerID)
	}
	sort.Strings(providers)
	return providers, nil
}

func (c LocalConfig) HasAuthProvider(providerID string) bool {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return false
	}
	for _, configured := range c.AuthProviders {
		if configured == providerID {
			return true
		}
	}
	return false
}

func LocalProviderAPIConfigs() ([]*database.ProviderApiConfig, error) {
	cfg, err := LoadLocalConfig()
	if err != nil {
		return nil, err
	}
	return cfg.ProviderAPIConfigs(time.Now()), nil
}

func LocalProviderAPIConfig(id string) (*database.ProviderApiConfig, error) {
	cfg, err := LoadLocalConfig()
	if err != nil {
		return nil, err
	}
	for _, apiCfg := range cfg.ProviderAPIConfigs(time.Now()) {
		if apiCfg.ID == id {
			return apiCfg, nil
		}
	}
	return nil, nil
}

func LocalDefaultProviderAPIConfig() (*database.ProviderApiConfig, error) {
	cfg, err := LoadLocalConfig()
	if err != nil {
		return nil, err
	}
	defaultProvider := cfg.defaultAuthProvider()
	if defaultProvider == "" {
		return nil, nil
	}
	for _, apiCfg := range cfg.ProviderAPIConfigs(time.Now()) {
		if strings.TrimPrefix(apiCfg.ID, localProviderAPIConfigIDPrefix) == defaultProvider {
			return apiCfg, nil
		}
	}
	return nil, nil
}

const localProviderAPIConfigIDPrefix = "pi-local-"

func LocalProviderAPIConfigID(providerID string) string {
	return localProviderAPIConfigIDPrefix + strings.TrimSpace(providerID)
}

func (c LocalConfig) ProviderAPIConfigs(now time.Time) []*database.ProviderApiConfig {
	defaultProvider := c.defaultAuthProvider()
	configs := make([]*database.ProviderApiConfig, 0, len(c.AuthProviders))
	for _, providerID := range c.AuthProviders {
		providerID = strings.TrimSpace(providerID)
		if providerID == "" {
			continue
		}
		configs = append(configs, &database.ProviderApiConfig{
			ID:         LocalProviderAPIConfigID(providerID),
			Name:       "Pi · " + displayProviderName(providerID),
			ProviderID: "pi",
			BaseURL:    upstreamBaseURL(providerID),
			IsDefault:  providerID == defaultProvider,
			IsBuiltin:  true,
			CreatedAt:  now,
			UpdatedAt:  now,
		})
	}
	return configs
}

func (c LocalConfig) defaultAuthProvider() string {
	if c.HasAuthProvider(c.DefaultProvider) {
		return strings.TrimSpace(c.DefaultProvider)
	}
	if len(c.AuthProviders) == 1 {
		return c.AuthProviders[0]
	}
	return ""
}

func (c LocalConfig) DefaultModelID() string {
	providerID := strings.TrimSpace(c.DefaultProvider)
	modelID := strings.TrimSpace(c.DefaultModel)
	if modelID == "" {
		return ""
	}
	if strings.Contains(modelID, "/") || providerID == "" {
		return modelID
	}
	return providerID + "/" + modelID
}

func ModelProvider(modelID string) string {
	modelID = strings.TrimSpace(modelID)
	if slash := strings.Index(modelID, "/"); slash > 0 {
		return modelID[:slash]
	}
	return ""
}

func ApplyLocalDefaults(config *provider.SessionConfig) {
	if config == nil {
		return
	}
	localCfg, err := LoadLocalConfig()
	if err != nil {
		return
	}
	if config.Model == "" {
		if defaultID := localCfg.DefaultModelID(); defaultID != "" && localCfg.HasAuthProvider(ModelProvider(defaultID)) {
			config.Model = defaultID
		}
	}
	if localCfg.DefaultThinkingLevel == "" {
		return
	}
	if config.Extra == nil {
		config.Extra = make(map[string]string)
	}
	if config.Extra["thinking_level"] == "" {
		config.Extra["thinking_level"] = localCfg.DefaultThinkingLevel
	}
}

func displayProviderName(providerID string) string {
	switch providerID {
	case "deepseek":
		return "DeepSeek"
	case "openai":
		return "OpenAI"
	case "anthropic":
		return "Anthropic"
	case "google", "gemini":
		return "Gemini"
	case "openrouter":
		return "OpenRouter"
	case "xai":
		return "xAI"
	case "zai":
		return "Z.ai"
	default:
		parts := strings.FieldsFunc(providerID, func(r rune) bool {
			return r == '-' || r == '_'
		})
		for i, part := range parts {
			if part == "" {
				continue
			}
			parts[i] = strings.ToUpper(part[:1]) + part[1:]
		}
		return strings.Join(parts, " ")
	}
}

func upstreamBaseURL(providerID string) string {
	switch providerID {
	case "deepseek":
		return "https://api.deepseek.com"
	case "openai":
		return "https://api.openai.com/v1"
	case "anthropic":
		return "https://api.anthropic.com"
	case "google", "gemini":
		return "https://generativelanguage.googleapis.com"
	default:
		return ""
	}
}
