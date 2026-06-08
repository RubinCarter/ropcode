package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/claude"
	"ropcode/internal/database"
	"ropcode/internal/provider/codex"
	providerPi "ropcode/internal/provider/pi"
)

const anthropicVersion = "2023-06-01"

type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func (a *App) SyncProviderModelsFromAPI(providerID, providerApiID string) ([]*database.ModelConfig, error) {
	return a.syncProviderModelsFromAPI(context.Background(), providerID, providerApiID)
}

func (a *App) SyncPiModelsFromLocalConfig() {
	localCfg, err := providerPi.LoadLocalConfig()
	if err != nil || len(localCfg.AuthProviders) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = a.syncProviderModelsFromAPI(ctx, "pi", "")
}

func (a *App) syncProviderModelsFromAPI(ctx context.Context, providerID, providerApiID string) ([]*database.ModelConfig, error) {
	if a.modelRegistry == nil || a.dbManager == nil {
		return []*database.ModelConfig{}, nil
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return []*database.ModelConfig{}, fmt.Errorf("provider_id is required")
	}

	if providerID == "pi" {
		modelIDs, err := fetchPiModelIDs(ctx)
		if err != nil {
			return []*database.ModelConfig{}, err
		}
		var localCfg providerPi.LocalConfig
		var hasLocalCfg bool
		if localCfg, err := providerPi.LoadLocalConfig(); err == nil {
			hasLocalCfg = len(localCfg.AuthProviders) > 0
			modelIDs = filterPiModelIDsByLocalConfig(modelIDs, localCfg)
			if defaultID := localCfg.DefaultModelID(); defaultID != "" && localCfg.HasAuthProvider(providerPi.ModelProvider(defaultID)) {
				modelIDs = prependModelID(modelIDs, defaultID)
			}
		}
		synced, err := a.modelRegistry.SyncProviderModels(providerID, modelIDs)
		if err != nil {
			return synced, err
		}
		if hasLocalCfg {
			_ = a.applyPiLocalModelAvailability(modelIDs)
			if defaultModelID := choosePiDefaultModelID(modelIDs, localCfg); defaultModelID != "" {
				_ = a.modelRegistry.SetDefaultModel(defaultModelID)
			}
		}
		return synced, nil
	}

	apiConfig, err := a.resolveProviderAPIConfig(providerID, providerApiID)
	if err != nil {
		return []*database.ModelConfig{}, err
	}

	modelIDs, err := fetchProviderModelIDs(providerID, apiConfig)
	if err != nil {
		return []*database.ModelConfig{}, err
	}
	return a.modelRegistry.SyncProviderModels(providerID, modelIDs)
}

func fetchPiModelIDs(ctx context.Context) ([]string, error) {
	cmd := exec.CommandContext(ctx, "pi", "--list-models", "--offline")
	cmd.Env = append(os.Environ(), "PI_OFFLINE=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("pi --list-models failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	modelIDs := parsePiListModelsOutput(string(out))
	if len(modelIDs) == 0 {
		return nil, fmt.Errorf("pi --list-models returned no usable models")
	}
	return modelIDs, nil
}

func filterPiModelIDsByLocalConfig(modelIDs []string, cfg providerPi.LocalConfig) []string {
	if len(cfg.AuthProviders) == 0 {
		return modelIDs
	}
	filtered := make([]string, 0, len(modelIDs))
	for _, modelID := range modelIDs {
		if cfg.HasAuthProvider(providerPi.ModelProvider(modelID)) {
			filtered = append(filtered, modelID)
		}
	}
	return filtered
}

func prependModelID(modelIDs []string, modelID string) []string {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return modelIDs
	}
	out := []string{modelID}
	for _, existing := range modelIDs {
		if existing != modelID {
			out = append(out, existing)
		}
	}
	return out
}

func choosePiDefaultModelID(modelIDs []string, cfg providerPi.LocalConfig) string {
	if len(modelIDs) == 0 {
		return ""
	}
	if defaultID := cfg.DefaultModelID(); defaultID != "" && cfg.HasAuthProvider(providerPi.ModelProvider(defaultID)) {
		for _, modelID := range modelIDs {
			if modelID == defaultID {
				return defaultID
			}
		}
	}
	return modelIDs[0]
}

func (a *App) applyPiLocalModelAvailability(allowedModelIDs []string) error {
	if a.dbManager == nil || len(allowedModelIDs) == 0 {
		return nil
	}
	allowed := make(map[string]bool, len(allowedModelIDs))
	for _, modelID := range allowedModelIDs {
		allowed[modelID] = true
	}
	existing, err := a.dbManager.GetModelConfigsByProvider("pi")
	if err != nil {
		return err
	}
	for _, model := range existing {
		if model == nil {
			continue
		}
		enabled := allowed[model.ModelID]
		if model.IsEnabled == enabled {
			continue
		}
		model.IsEnabled = enabled
		if err := a.dbManager.SaveModelConfig(model); err != nil {
			return err
		}
	}
	return nil
}

func parsePiListModelsOutput(output string) []string {
	seen := make(map[string]bool)
	modelIDs := make([]string, 0)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.EqualFold(fields[0], "provider") {
			continue
		}
		providerID := strings.TrimSpace(fields[0])
		modelID := strings.TrimSpace(fields[1])
		if providerID == "" || modelID == "" || strings.Contains(providerID, "-") && modelID == "model" {
			continue
		}
		fullID := providerID + "/" + modelID
		if !seen[fullID] {
			seen[fullID] = true
			modelIDs = append(modelIDs, fullID)
		}
	}
	sort.Strings(modelIDs)
	return modelIDs
}

func (a *App) resolveProviderAPIConfig(providerID, providerApiID string) (*database.ProviderApiConfig, error) {
	if strings.TrimSpace(providerApiID) != "" {
		cfg, err := a.dbManager.GetProviderApiConfig(providerApiID)
		if err == nil && cfg != nil {
			log.Printf("[ModelsSync] %s using explicit api config id=%s base=%q", providerID, cfg.ID, cfg.BaseURL)
		}
		return cfg, err
	}
	if cfg, err := a.dbManager.GetDefaultProviderApiConfig(providerID); err == nil && cfg != nil {
		log.Printf("[ModelsSync] %s using default api config id=%s base=%q", providerID, cfg.ID, cfg.BaseURL)
		return cfg, nil
	}
	if providerID == "pi" {
		if cfg, err := providerPi.LocalDefaultProviderAPIConfig(); err == nil && cfg != nil {
			return cfg, nil
		}
	}
	if providerID == "codex" {
		if cfg := codexConfigToProviderAPI(); cfg != nil {
			log.Printf("[ModelsSync] codex using ~/.codex/config.toml provider=%q base=%q", cfg.Name, cfg.BaseURL)
			return cfg, nil
		}
	}
	if providerID == "claude" {
		if cfg := claudeSettingsToProviderAPI(); cfg != nil {
			log.Printf("[ModelsSync] claude using ~/.claude/settings.json base=%q", cfg.BaseURL)
			return cfg, nil
		}
	}
	if all, err := a.dbManager.GetAllProviderApiConfigs(); err == nil {
		for _, cfg := range all {
			if cfg != nil && cfg.ProviderID == providerID {
				log.Printf("[ModelsSync] %s using first api config id=%s base=%q (no default flagged)", providerID, cfg.ID, cfg.BaseURL)
				return cfg, nil
			}
		}
	}
	switch providerID {
	case "codex":
		log.Printf("[ModelsSync] codex no api config saved; falling back to OPENAI_API_KEY env")
		return &database.ProviderApiConfig{
			ProviderID: providerID,
			BaseURL:    "https://api.openai.com",
			AuthToken:  os.Getenv("OPENAI_API_KEY"),
		}, nil
	case "claude":
		token := os.Getenv("ANTHROPIC_API_KEY")
		if token == "" {
			token = os.Getenv("ANTHROPIC_AUTH_TOKEN")
		}
		log.Printf("[ModelsSync] claude no api config saved; falling back to ANTHROPIC env vars")
		return &database.ProviderApiConfig{
			ProviderID: providerID,
			BaseURL:    firstNonEmpty(os.Getenv("ANTHROPIC_BASE_URL"), "https://api.anthropic.com"),
			AuthToken:  token,
		}, nil
	}
	return nil, fmt.Errorf("no provider API config found for %s", providerID)
}

func codexConfigToProviderAPI() *database.ProviderApiConfig {
	provider, err := codex.LoadActiveProvider()
	if err != nil || provider == nil || strings.TrimSpace(provider.BaseURL) == "" {
		return nil
	}
	return &database.ProviderApiConfig{
		ProviderID: "codex",
		Name:       "codex config (" + provider.Name + ")",
		BaseURL:    provider.BaseURL,
		AuthToken:  provider.AuthToken,
	}
}

func claudeSettingsToProviderAPI() *database.ProviderApiConfig {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	env, err := claude.LoadSettingsEnv(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		return nil
	}
	baseURL := strings.TrimSpace(env["ANTHROPIC_BASE_URL"])
	token := strings.TrimSpace(firstNonEmpty(env["ANTHROPIC_AUTH_TOKEN"], env["ANTHROPIC_API_KEY"]))
	if baseURL == "" {
		return nil
	}
	return &database.ProviderApiConfig{
		ProviderID: "claude",
		Name:       "claude settings.json",
		BaseURL:    baseURL,
		AuthToken:  token,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func fetchProviderModelIDs(providerID string, apiConfig *database.ProviderApiConfig) ([]string, error) {
	switch providerID {
	case "claude":
		return fetchAnthropicModelIDs(apiConfig)
	default:
		return fetchOpenAICompatibleModelIDs(apiConfig)
	}
}

func fetchOpenAICompatibleModelIDs(apiConfig *database.ProviderApiConfig) ([]string, error) {
	if apiConfig == nil {
		return nil, fmt.Errorf("provider API config is required")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(apiConfig.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	endpoint := baseURL + "/v1/models"

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiConfig.AuthToken) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiConfig.AuthToken))
	}
	return doModelsListRequest(req, "OpenAI")
}

func fetchAnthropicModelIDs(apiConfig *database.ProviderApiConfig) ([]string, error) {
	if apiConfig == nil {
		return nil, fmt.Errorf("provider API config is required")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(apiConfig.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	endpoint := baseURL + "/v1/models"

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if token := strings.TrimSpace(apiConfig.AuthToken); token != "" {
		req.Header.Set("x-api-key", token)
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("anthropic-version", anthropicVersion)
	return doModelsListRequest(req, "Anthropic")
}

func doModelsListRequest(req *http.Request, label string) ([]string, error) {
	log.Printf("[ModelsSync] %s GET %s", label, req.URL.String())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[ModelsSync] %s request error: %v", label, err)
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	log.Printf("[ModelsSync] %s status=%d content-type=%q body=%dB", label, resp.StatusCode, resp.Header.Get("Content-Type"), len(body))
	if resp.StatusCode == http.StatusNotFound {
		return nil, missingModelsEndpointError(label)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s models API returned %s: %s", label, resp.Status, strings.TrimSpace(string(body)))
	}
	if looksLikeHTML(resp.Header.Get("Content-Type"), body) {
		return nil, missingModelsEndpointError(label)
	}

	var parsed openAIModelsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("%s models API returned unrecognised body: %w", label, err)
	}

	modelIDs := make([]string, 0, len(parsed.Data))
	for _, model := range parsed.Data {
		if strings.TrimSpace(model.ID) != "" {
			modelIDs = append(modelIDs, model.ID)
		}
	}
	sort.Strings(modelIDs)
	return modelIDs, nil
}

func missingModelsEndpointError(label string) error {
	return fmt.Errorf("%s endpoint does not expose /v1/models. Add models manually via \"Add Model\".", label)
}

func looksLikeHTML(contentType string, body []byte) bool {
	if ct := strings.ToLower(strings.TrimSpace(contentType)); ct != "" {
		if strings.HasPrefix(ct, "text/html") || strings.HasPrefix(ct, "application/xhtml") {
			return true
		}
	}
	trimmed := strings.TrimLeft(string(body), " \t\r\n\xef\xbb\xbf")
	return strings.HasPrefix(trimmed, "<")
}
