package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/provider/codex"
)

const anthropicVersion = "2023-06-01"

type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func (a *App) SyncProviderModelsFromAPI(providerID, providerApiID string) ([]*database.ModelConfig, error) {
	if a.modelRegistry == nil || a.dbManager == nil {
		return []*database.ModelConfig{}, nil
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return []*database.ModelConfig{}, fmt.Errorf("provider_id is required")
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

func (a *App) resolveProviderAPIConfig(providerID, providerApiID string) (*database.ProviderApiConfig, error) {
	if strings.TrimSpace(providerApiID) != "" {
		return a.dbManager.GetProviderApiConfig(providerApiID)
	}
	if cfg, err := a.dbManager.GetDefaultProviderApiConfig(providerID); err == nil && cfg != nil {
		return cfg, nil
	}
	if providerID == "codex" {
		if cfg := codexConfigToProviderAPI(); cfg != nil {
			return cfg, nil
		}
	}
	if all, err := a.dbManager.GetAllProviderApiConfigs(); err == nil {
		for _, cfg := range all {
			if cfg != nil && cfg.ProviderID == providerID {
				return cfg, nil
			}
		}
	}
	switch providerID {
	case "codex":
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
		return &database.ProviderApiConfig{
			ProviderID: providerID,
			BaseURL:    "https://api.anthropic.com",
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
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
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
