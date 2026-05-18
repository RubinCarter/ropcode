package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ropcode/internal/database"
)

const maxGeneratedSessionTitleRunes = 60
const maxFallbackSessionTitleRunes = 36
const generatedSessionTitlesSettingKey = "generated_session_titles"

type sessionTitleChatRequest struct {
	Model       string                    `json:"model"`
	Messages    []sessionTitleChatMessage `json:"messages"`
	Temperature float64                   `json:"temperature"`
	MaxTokens   int                       `json:"max_tokens"`
}

type sessionTitleChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type sessionTitleChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type sessionTitleAnthropicRequest struct {
	Model       string                      `json:"model"`
	System      string                      `json:"system"`
	Messages    []sessionTitleAnthropicPart `json:"messages"`
	Temperature float64                     `json:"temperature"`
	MaxTokens   int                         `json:"max_tokens"`
}

type sessionTitleAnthropicPart struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type sessionTitleAnthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

const sessionTitleSystemPrompt = "Generate a concise chat session title in the user's language. Use 3 to 8 words. Return only the title, without quotes or punctuation."

type sessionTitleStore struct {
	mu     sync.RWMutex
	titles map[string]string
}

func newSessionTitleStore() *sessionTitleStore {
	return &sessionTitleStore{titles: make(map[string]string)}
}

func sessionTitleKey(provider, sessionID string) string {
	return strings.TrimSpace(provider) + ":" + strings.TrimSpace(sessionID)
}

func (s *sessionTitleStore) Set(provider, sessionID, title string) {
	if s == nil {
		return
	}
	key := sessionTitleKey(provider, sessionID)
	title = cleanGeneratedSessionTitle(title)
	if key == ":" || title == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.titles[key] = title
}

func (s *sessionTitleStore) Get(provider, sessionID string) string {
	if s == nil {
		return ""
	}
	key := sessionTitleKey(provider, sessionID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.titles[key]
}

func (s *sessionTitleStore) Load(titles map[string]string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.titles == nil {
		s.titles = make(map[string]string)
	}
	for key, title := range titles {
		key = strings.TrimSpace(key)
		title = cleanGeneratedSessionTitle(title)
		if key == "" || title == "" {
			continue
		}
		s.titles[key] = title
	}
}

func (s *sessionTitleStore) Snapshot() map[string]string {
	result := make(map[string]string)
	if s == nil {
		return result
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for key, title := range s.titles {
		result[key] = title
	}
	return result
}

func (a *App) loadGeneratedSessionTitles() {
	if a.dbManager == nil {
		return
	}
	raw, err := a.dbManager.GetSetting(generatedSessionTitlesSettingKey)
	if err != nil {
		log.Printf("[SessionTitle] failed to load generated session titles: %v", err)
		return
	}
	if strings.TrimSpace(raw) == "" {
		return
	}
	var titles map[string]string
	if err := json.Unmarshal([]byte(raw), &titles); err != nil {
		log.Printf("[SessionTitle] failed to parse generated session titles: %v", err)
		return
	}
	if a.sessionTitles == nil {
		a.sessionTitles = newSessionTitleStore()
	}
	a.sessionTitles.Load(titles)
}

// GenerateSessionTitle uses the configured low-cost title model to name a new
// chat session. Missing config disables generation without affecting the chat.
func (a *App) GenerateSessionTitle(prompt string) (string, error) {
	if a.dbManager == nil {
		return "", nil
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", nil
	}

	providerID, err := a.dbManager.GetSetting("session_title_provider")
	if err != nil {
		return "", fmt.Errorf("load session title provider setting: %w", err)
	}
	model, err := a.dbManager.GetSetting("session_title_model")
	if err != nil {
		return "", fmt.Errorf("load session title model setting: %w", err)
	}

	providerID = strings.TrimSpace(providerID)
	model = strings.TrimSpace(model)
	if providerID == "" || model == "" {
		return fallbackSessionTitleFromPrompt(prompt), nil
	}

	apiConfig, err := a.resolveProviderAPIConfig(providerID, "")
	if err != nil {
		log.Printf("[SessionTitle] provider config unavailable for %s: %v", providerID, err)
		return fallbackSessionTitleFromPrompt(prompt), nil
	}

	title, err := generateSessionTitleWithConfig(apiConfig, model, prompt)
	if err != nil {
		log.Printf("[SessionTitle] generation failed: %v", err)
		return fallbackSessionTitleFromPrompt(prompt), nil
	}
	if strings.TrimSpace(title) == "" {
		return fallbackSessionTitleFromPrompt(prompt), nil
	}
	return title, nil
}

func (a *App) SaveGeneratedSessionTitle(provider, sessionID, title string) error {
	if a.sessionTitles == nil {
		a.sessionTitles = newSessionTitleStore()
	}
	a.sessionTitles.Set(provider, sessionID, title)
	if a.dbManager == nil {
		return nil
	}
	data, err := json.Marshal(a.sessionTitles.Snapshot())
	if err != nil {
		return fmt.Errorf("encode generated session titles: %w", err)
	}
	if err := a.dbManager.SaveSetting(generatedSessionTitlesSettingKey, string(data)); err != nil {
		return fmt.Errorf("save generated session titles: %w", err)
	}
	return nil
}

func applyStoredSessionTitle(summary ProviderSessionSummary, store *sessionTitleStore) ProviderSessionSummary {
	if title := store.Get(summary.Provider, summary.ID); title != "" {
		summary.Title = title
	}
	return summary
}

func generateSessionTitleWithConfig(apiConfig *database.ProviderApiConfig, model, prompt string) (string, error) {
	if apiConfig == nil {
		return "", fmt.Errorf("provider API config is required")
	}
	model = strings.TrimSpace(model)
	prompt = strings.TrimSpace(prompt)
	if model == "" || prompt == "" {
		return "", nil
	}
	if strings.TrimSpace(apiConfig.ProviderID) == "claude" {
		return generateSessionTitleWithAnthropic(apiConfig, model, prompt)
	}

	return generateSessionTitleWithOpenAICompatible(apiConfig, model, prompt)
}

func generateSessionTitleWithOpenAICompatible(apiConfig *database.ProviderApiConfig, model, prompt string) (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(apiConfig.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	payload := sessionTitleChatRequest{
		Model: model,
		Messages: []sessionTitleChatMessage{
			{
				Role:    "system",
				Content: sessionTitleSystemPrompt,
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Temperature: 0.2,
		MaxTokens:   32,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiConfig.AuthToken) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiConfig.AuthToken))
	}

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("session title API returned %s: %s", resp.Status, strings.TrimSpace(string(responseBody)))
	}

	var parsed sessionTitleChatResponse
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", nil
	}
	return cleanGeneratedSessionTitle(parsed.Choices[0].Message.Content), nil
}

func generateSessionTitleWithAnthropic(apiConfig *database.ProviderApiConfig, model, prompt string) (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(apiConfig.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}

	payload := sessionTitleAnthropicRequest{
		Model:  model,
		System: sessionTitleSystemPrompt,
		Messages: []sessionTitleAnthropicPart{
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Temperature: 0.2,
		MaxTokens:   32,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	if strings.TrimSpace(apiConfig.AuthToken) != "" {
		req.Header.Set("x-api-key", strings.TrimSpace(apiConfig.AuthToken))
	}

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("session title API returned %s: %s", resp.Status, strings.TrimSpace(string(responseBody)))
	}

	var parsed sessionTitleAnthropicResponse
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return "", err
	}
	for _, content := range parsed.Content {
		if strings.TrimSpace(content.Text) != "" {
			return cleanGeneratedSessionTitle(content.Text), nil
		}
	}
	return "", nil
}

func cleanGeneratedSessionTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	title = strings.Split(title, "\n")[0]
	title = strings.TrimSpace(title)
	title = strings.Trim(title, "\"'`“”‘’")
	title = strings.TrimSpace(title)
	title = strings.TrimSuffix(title, ".")
	title = strings.TrimSuffix(title, "。")
	title = strings.TrimSpace(title)

	if utf8.RuneCountInString(title) <= maxGeneratedSessionTitleRunes {
		return title
	}
	runes := []rune(title)
	return strings.TrimSpace(string(runes[:maxGeneratedSessionTitleRunes]))
}

func fallbackSessionTitleFromPrompt(prompt string) string {
	title := strings.TrimSpace(prompt)
	if title == "" {
		return ""
	}

	title = strings.ReplaceAll(title, "\r\n", "\n")
	title = strings.Split(title, "\n")[0]
	title = strings.TrimSpace(title)
	title = strings.Trim(title, "\"'`“”‘’")
	title = strings.TrimSpace(title)
	title = strings.TrimRight(title, ".。!?！？")
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	if utf8.RuneCountInString(title) <= maxFallbackSessionTitleRunes {
		return title
	}
	runes := []rune(title)
	return strings.TrimSpace(string(runes[:maxFallbackSessionTitleRunes]))
}
