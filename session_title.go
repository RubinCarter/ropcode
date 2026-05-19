package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ropcode/internal/claude"
	"ropcode/internal/database"
	"ropcode/internal/git"
)

const (
	maxGeneratedSessionTitleRunes    = 60
	maxFallbackSessionTitleRunes     = 36
	maxBranchNameRunes               = 30
	// Keep the transcript tight: small models do better with focused tails,
	// and the longer the transcript the slower the CLI bootstrap pays off.
	maxTranscriptRunes               = 1600
	maxTranscriptTurns               = 8
	maxTranscriptTurnRunes           = 280
	// Hard cap on the combined system + user prompt we hand to the title CLI.
	// Claude CLI auto-injects skills/CLAUDE.md/agents into its own system
	// prompt; we leave plenty of headroom under the 200K context window.
	titleInputBudgetRunes            = 150000
	generatedSessionTitlesSettingKey = "generated_session_titles"
	sessionTitleCLITimeout           = 60 * time.Second
)

const sessionTitleSystemPrompt = "You are a title generator. The user will give you their first message from a coding chat. Summarize WHAT THEY WANT TO DO in 3-8 words in their language. Output only the title. Never output generic phrases like 'new session', 'conversation setup', 'chat session', or 'getting started'."

const latestFocusTitleSystemPrompt = "You retitle a coding chat session. Read the transcript and write a short title that names the CURRENT focus of the work — what the user is doing now, not what they started with. Use the user's language. 3 to 8 words. Output only the title, no quotes, no trailing punctuation. Never output generic phrases like 'new session', 'conversation setup', 'chat session', or 'getting started'."

const branchNameSystemPrompt = "You rename a git branch to reflect the current focus of work in the chat transcript. Output ONE kebab-case English slug, 2 to 4 words, lowercase ASCII letters digits and hyphens only, max 24 characters. No prefixes like 'feat/', no quotes, no explanation. Just the slug."

// __MORE__

// genericTitlePatterns matches titles that describe the session itself rather
// than the content of the conversation. These are useless as titles.
var genericTitlePatterns = regexp.MustCompile(`(?i)^(new\s+)?(conversation|chat|session|dialogue|discussion)\s*(session|setup|start|begin|title|created|initiated|opened|established)`)

func isGenericTitle(title string) bool {
	if title == "" {
		return true
	}
	lower := strings.ToLower(title)
	generics := []string{
		"new conversation",
		"new session",
		"new chat",
		"conversation setup",
		"session setup",
		"chat session",
		"getting started",
		"untitled session",
		"untitled conversation",
		"hello",
		"hi there",
		"no transcript",
		"please include",
		"please provide",
		"i cannot",
		"i can't",
		"i don't have",
		"i'm unable",
		"as an ai",
		"i need more",
	}
	for _, g := range generics {
		if strings.Contains(lower, g) {
			return true
		}
	}
	return genericTitlePatterns.MatchString(title)
}

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

// __MORE2__
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

// extractMessageText pulls plain text out of a Claude/Codex JSONL message map.
// Claude history loaders end up with []interface{} content (JSON-unmarshaled);
// the Codex history loader builds messages in Go with a typed
// []map[string]interface{} content slice — handle both.
func extractMessageText(msg map[string]interface{}) string {
	if msg == nil {
		return ""
	}
	switch c := msg["content"].(type) {
	case string:
		return c
	case []interface{}:
		var b strings.Builder
		for _, item := range c {
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			appendItemText(&b, m)
		}
		return b.String()
	case []map[string]interface{}:
		var b strings.Builder
		for _, m := range c {
			appendItemText(&b, m)
		}
		return b.String()
	}
	return ""
}

func appendItemText(b *strings.Builder, m map[string]interface{}) {
	t, _ := m["type"].(string)
	if t != "text" && t != "" {
		return
	}
	text, ok := m["text"].(string)
	if !ok || text == "" {
		return
	}
	if b.Len() > 0 {
		b.WriteByte('\n')
	}
	b.WriteString(text)
}

// buildRecentTranscript serializes the last user/assistant turns into a compact
// transcript suitable for a small summarization model. Keeps only the tail —
// the title is supposed to reflect the *current* focus, not session history.
func buildRecentTranscript(messages []claude.Message) string {
	if len(messages) == 0 {
		return ""
	}

	turns := make([]string, 0, maxTranscriptTurns)
	// Walk backwards, collect non-empty / non-sidechain turns until we have
	// enough, then reverse for chronological order.
	for i := len(messages) - 1; i >= 0 && len(turns) < maxTranscriptTurns; i-- {
		msg := messages[i]
		if msg.IsSidechain {
			continue
		}
		role := "User"
		switch msg.Type {
		case "assistant":
			role = "Assistant"
		case "user":
			role = "User"
		default:
			continue
		}
		text := strings.TrimSpace(extractMessageText(msg.Message))
		if text == "" {
			continue
		}
		if utf8.RuneCountInString(text) > maxTranscriptTurnRunes {
			runes := []rune(text)
			text = strings.TrimSpace(string(runes[:maxTranscriptTurnRunes])) + "…"
		}
		turns = append(turns, role+": "+text)
	}
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}

	transcript := strings.Join(turns, "\n\n")
	if utf8.RuneCountInString(transcript) > maxTranscriptRunes {
		runes := []rune(transcript)
		transcript = "…" + string(runes[len(runes)-maxTranscriptRunes:])
	}
	return transcript
}

// wrapTranscriptForTitling formats a transcript with explicit instructions so
// the model treats it as data to summarize, not a message to reply to.
// Uses --- delimiters instead of XML tags to avoid CLI/model tag stripping.
func wrapTranscriptForTitling(transcript, instruction string) string {
	return strings.TrimSpace(instruction) + "\n\n---TRANSCRIPT START---\n" + transcript + "\n---TRANSCRIPT END---"
}

// enforceTitleInputBudget guarantees that the system prompt + user prompt
// stay under titleInputBudgetRunes. The system prompt is small and stable, so
// we only ever trim the user prompt; we keep the tail so the latest focus
// survives.
func enforceTitleInputBudget(systemPrompt, userPrompt string) (string, string) {
	systemRunes := utf8.RuneCountInString(systemPrompt)
	if systemRunes >= titleInputBudgetRunes {
		// Pathological — caller passed a huge system prompt. Trim it too.
		runes := []rune(systemPrompt)
		systemPrompt = string(runes[:titleInputBudgetRunes/2])
		systemRunes = utf8.RuneCountInString(systemPrompt)
	}
	allowance := titleInputBudgetRunes - systemRunes
	if utf8.RuneCountInString(userPrompt) <= allowance {
		return systemPrompt, userPrompt
	}
	runes := []rune(userPrompt)
	trimmed := "…(transcript head trimmed)…\n" + string(runes[len(runes)-allowance:])
	return systemPrompt, trimmed
}

// titleClaudeHomeDir returns a stable, sanitized HOME directory for claude
// CLI title generation. It contains only credentials/settings copied from the
// real home — no skills, no agents, no CLAUDE.md, no projects. That keeps
// claude's auto-loaded system prompt small enough to stay under the model's
// context window even when the user has installed many skills.
func (a *App) titleClaudeHomeDir() (string, error) {
	realHome, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	titleHome := filepath.Join(realHome, ".ropcode-cache", "title-home")
	titleClaudeDir := filepath.Join(titleHome, ".claude")
	if err := os.MkdirAll(titleClaudeDir, 0o755); err != nil {
		return "", err
	}

	// Copy auth/config artifacts. The list is intentional: anything not on it
	// (skills/, agents/, projects/, CLAUDE.md, todos/, ide/, history.jsonl)
	// is kept out so claude's system prompt stays minimal.
	realClaudeDir := filepath.Join(realHome, ".claude")
	for _, name := range []string{".credentials.json", "settings.json", ".config.json", "config.json"} {
		src := filepath.Join(realClaudeDir, name)
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		dst := filepath.Join(titleClaudeDir, name)
		if writeErr := os.WriteFile(dst, data, 0o600); writeErr != nil {
			log.Printf("[SessionTitle] copy %s into title home failed: %v", name, writeErr)
		}
	}

	return titleHome, nil
}

// titleCLIWorkDir returns a bare directory for the Claude CLI to run in.
// It must NOT contain .claude/ or .git/ — otherwise the CLI treats it as a
// project root and injects project context into the system prompt.
func (a *App) titleCLIWorkDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := filepath.Join(home, ".ropcode-cache", "title-cwd")
	os.MkdirAll(dir, 0o755)
	return dir
}

// __MORE3__
// runCLIForTitle invokes the matching local CLI (claude / codex / gemini) in
// one-shot exec mode to generate a short title or branch name. If the direct
// API is configured (session_title_provider_api_id + session_title_model), it
// uses that instead — much faster and avoids CLI argument length limits on Windows.
func (a *App) runCLIForTitle(ctx context.Context, provider, projectPath, model, systemPrompt, userPrompt string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	model = strings.TrimSpace(model)
	if userPrompt = strings.TrimSpace(userPrompt); userPrompt == "" {
		return "", fmt.Errorf("user prompt is empty")
	}

	// Try direct API first (OpenAI-compatible, fast, no CLI overhead).
	apiURL, apiKey, _, _, _ := a.loadTitleAPIConfig()
	if apiURL != "" && apiKey != "" {
		return a.runDirectAPIForTitle(ctx, model, systemPrompt, userPrompt)
	}

	// Fallback: merge system prompt into user prompt and spawn CLI.
	if sys := strings.TrimSpace(systemPrompt); sys != "" {
		userPrompt = sys + "\n\n" + userPrompt
	}
	_, userPrompt = enforceTitleInputBudget("", userPrompt)

	switch provider {
	case "claude", "anthropic":
		return a.runClaudeCLIForTitle(ctx, projectPath, model, userPrompt)
	case "codex", "openai":
		return a.runCodexCLIForTitle(ctx, projectPath, model, userPrompt)
	case "gemini", "google":
		return a.runGeminiCLIForTitle(ctx, projectPath, model, userPrompt)
	default:
		return "", fmt.Errorf("unsupported title provider %q", provider)
	}
}

func resolveCLIWorkingDir(projectPath string) string {
	projectPath = strings.TrimSpace(projectPath)
	if projectPath == "" {
		return ""
	}
	if info, err := os.Stat(projectPath); err == nil && info.IsDir() {
		return projectPath
	}
	return ""
}

// loadTitleAPIConfig resolves the API settings for title generation.
// Reads session_title_provider_api_id which can be either a DB ProviderApiConfig ID
// or a synthetic env-detected ID (e.g. "env:claude").
func (a *App) loadTitleAPIConfig() (apiURL, apiKey, model, apiFormat string, err error) {
	if a.dbManager == nil {
		return "", "", "", "", fmt.Errorf("database not initialized")
	}

	model, _ = a.dbManager.GetSetting("session_title_model")
	model = strings.TrimSpace(model)

	providerApiID, _ := a.dbManager.GetSetting("session_title_provider_api_id")
	providerApiID = strings.TrimSpace(providerApiID)
	if providerApiID == "" {
		return "", "", model, "", fmt.Errorf("session title provider not configured")
	}

	// Resolve the provider config (DB entry or env-detected)
	resolved := a.resolveTitleProviderConfig(providerApiID)
	if resolved == nil {
		return "", "", model, "", fmt.Errorf("provider config %q not found", providerApiID)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(resolved.BaseURL), "/")
	apiKey = strings.TrimSpace(resolved.AuthToken)
	if baseURL == "" || apiKey == "" {
		return "", "", model, "", fmt.Errorf("provider config %q missing base_url or auth_token", providerApiID)
	}

	if resolved.ProviderID == "claude" {
		apiFormat = "anthropic"
		if !strings.Contains(baseURL, "/v1/messages") {
			apiURL = baseURL + "/v1/messages"
		} else {
			apiURL = baseURL
		}
	} else {
		apiFormat = "openai"
		if !strings.Contains(baseURL, "/v1/chat/completions") {
			apiURL = baseURL + "/v1/chat/completions"
		} else {
			apiURL = baseURL
		}
	}

	return apiURL, apiKey, model, apiFormat, nil
}

// TitleProviderOption represents a provider option for the title generation dropdown.
type TitleProviderOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ProviderID string `json:"provider_id"`
	Source     string `json:"source"` // "db" or "env"
}

// GetSessionTitleProviderOptions returns a unified list of available provider configs
// combining DB entries and auto-detected env configurations.
func (a *App) GetSessionTitleProviderOptions() ([]TitleProviderOption, error) {
	options := make([]TitleProviderOption, 0)

	// 1. DB provider API configs
	if a.dbManager != nil {
		configs, err := a.dbManager.GetAllProviderApiConfigs()
		if err == nil {
			for _, cfg := range configs {
				if cfg == nil || cfg.BaseURL == "" || cfg.AuthToken == "" {
					continue
				}
				options = append(options, TitleProviderOption{
					ID:         cfg.ID,
					Name:       cfg.Name,
					ProviderID: cfg.ProviderID,
					Source:     "db",
				})
			}
		}
	}

	// 2. Auto-detected from ~/.claude/settings.json
	if baseURL, authToken := readClaudeSettingsEnv(); baseURL != "" && authToken != "" {
		options = append(options, TitleProviderOption{
			ID:         "env:claude",
			Name:       "Claude (settings.json)",
			ProviderID: "claude",
			Source:     "env",
		})
	}

	return options, nil
}

// resolveTitleProviderConfig resolves a provider config by ID.
// Supports both DB IDs and synthetic env IDs like "env:claude".
func (a *App) resolveTitleProviderConfig(id string) *database.ProviderApiConfig {
	if strings.HasPrefix(id, "env:") {
		switch id {
		case "env:claude":
			baseURL, authToken := readClaudeSettingsEnv()
			if baseURL != "" && authToken != "" {
				return &database.ProviderApiConfig{
					ID:         "env:claude",
					Name:       "Claude (settings.json)",
					ProviderID: "claude",
					BaseURL:    baseURL,
					AuthToken:  authToken,
				}
			}
		}
		return nil
	}

	if a.dbManager == nil {
		return nil
	}
	cfg, err := a.dbManager.GetProviderApiConfig(id)
	if err != nil || cfg == nil {
		return nil
	}
	return cfg
}

func readClaudeSettingsEnv() (baseURL, authToken string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}
	data, err := os.ReadFile(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		return "", ""
	}
	var settings struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return "", ""
	}
	baseURL = settings.Env["ANTHROPIC_BASE_URL"]
	authToken = settings.Env["ANTHROPIC_AUTH_TOKEN"]
	if authToken == "" {
		authToken = settings.Env["ANTHROPIC_API_KEY"]
	}
	return baseURL, authToken
}

// GetSessionTitleAvailableModels queries the configured API endpoint's /v1/models
// and returns the list of available model IDs for the title generation dropdown.
func (a *App) GetSessionTitleAvailableModels() ([]string, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	providerApiID, _ := a.dbManager.GetSetting("session_title_provider_api_id")
	providerApiID = strings.TrimSpace(providerApiID)
	if providerApiID == "" {
		return nil, fmt.Errorf("no provider selected")
	}

	resolved := a.resolveTitleProviderConfig(providerApiID)
	if resolved == nil {
		return nil, fmt.Errorf("provider config %q not found", providerApiID)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(resolved.BaseURL), "/")
	apiKey := strings.TrimSpace(resolved.AuthToken)
	if baseURL == "" || apiKey == "" {
		return nil, fmt.Errorf("provider config missing base_url or auth_token")
	}

	modelsURL := baseURL + "/v1/models"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", modelsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch models: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse models response: %w", err)
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	return models, nil
}
// endpoint directly via HTTP. Bypasses the CLI entirely.
func (a *App) runDirectAPIForTitle(ctx context.Context, model, systemPrompt, userPrompt string) (string, error) {
	apiURL, apiKey, _, apiFormat, err := a.loadTitleAPIConfig()
	if err != nil || apiURL == "" || apiKey == "" {
		return "", fmt.Errorf("title API not configured (select a Provider in Settings): %v", err)
	}

	if apiFormat == "anthropic" {
		return a.callAnthropicAPI(ctx, apiURL, apiKey, model, systemPrompt, userPrompt)
	}
	return a.callOpenAIAPI(ctx, apiURL, apiKey, model, systemPrompt, userPrompt)
}

func (a *App) callOpenAIAPI(ctx context.Context, apiURL, apiKey, model, systemPrompt, userPrompt string) (string, error) {
	messages := []map[string]string{}
	if strings.TrimSpace(systemPrompt) != "" {
		messages = append(messages, map[string]string{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": userPrompt})

	reqBody := map[string]interface{}{
		"model":      model,
		"max_tokens": 4096,
		"messages":   messages,
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response: %w (body: %.200s)", err, string(respBody))
	}
	if len(result.Choices) > 0 {
		text := strings.TrimSpace(result.Choices[0].Message.Content)
		if text != "" {
			return text, nil
		}
	}
	return "", fmt.Errorf("API returned no text content (body: %.500s)", string(respBody))
}

func (a *App) callAnthropicAPI(ctx context.Context, apiURL, apiKey, model, systemPrompt, userPrompt string) (string, error) {
	reqBody := map[string]interface{}{
		"model":      model,
		"max_tokens": 60,
		"messages": []map[string]string{
			{"role": "user", "content": userPrompt},
		},
	}
	if strings.TrimSpace(systemPrompt) != "" {
		reqBody["system"] = systemPrompt
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}
	for _, block := range result.Content {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			return strings.TrimSpace(block.Text), nil
		}
	}
	return "", fmt.Errorf("API returned no text content")
}

func (a *App) runClaudeCLIForTitle(ctx context.Context, projectPath, model, prompt string) (string, error) {
	if a.claudeManager == nil {
		return "", fmt.Errorf("claude manager not initialized")
	}
	binary := a.claudeManager.GetBinaryPath()
	if strings.TrimSpace(binary) == "" {
		return "", fmt.Errorf("claude CLI binary not found; run `claude --version` to verify install")
	}

	args := []string{
		"-p", prompt,
		"--output-format", "text",
		"--dangerously-skip-permissions",
		"--max-turns", "1",
		"--mcp-config", "{}",
		"--strict-mcp-config",
		"--disallowed-tools", "*",
	}
	if model != "" {
		args = append(args, "--model", model)
	}

	runCtx, cancel := context.WithTimeout(ctx, sessionTitleCLITimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, binary, args...)
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=true")

	// Run from a bare directory with NO .claude/ or .git/ so the CLI doesn't
	// inject project context into its system prompt. Keep the real HOME so
	// the CLI can find credentials and config without hanging.
	if cwd := a.titleCLIWorkDir(); cwd != "" {
		cmd.Dir = cwd
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("claude CLI failed: %w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

func (a *App) runCodexCLIForTitle(ctx context.Context, projectPath, model, prompt string) (string, error) {
	if a.codexManager == nil {
		return "", fmt.Errorf("codex manager not initialized")
	}
	binary := a.codexManager.GetBinaryPath()
	if strings.TrimSpace(binary) == "" {
		return "", fmt.Errorf("codex CLI binary not found; run `codex --version` to verify install")
	}

	args := []string{
		"exec",
		"--sandbox", "read-only",
		"-c", `approval_policy="never"`,
		"-c", "mcp_servers={}",
		"-c", "shell_environment_policy.inherit=\"none\"",
		"--json",
		"--color", "never",
	}
	if model != "" {
		args = append(args, "-m", model)
	}
	if dir := resolveCLIWorkingDir(projectPath); dir != "" {
		args = append(args, "-C", dir)
	}
	args = append(args, "--", prompt)

	runCtx, cancel := context.WithTimeout(ctx, sessionTitleCLITimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, binary, args...)
	cmd.Dir = resolveCLIWorkingDir(projectPath)
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("codex CLI failed: %w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}
	text := extractCodexAssistantText(stdout.String())
	if text == "" {
		return "", fmt.Errorf("codex CLI returned no assistant text (stderr: %s)", strings.TrimSpace(stderr.String()))
	}
	return text, nil
}

func (a *App) runGeminiCLIForTitle(ctx context.Context, projectPath, model, prompt string) (string, error) {
	if a.geminiManager == nil {
		return "", fmt.Errorf("gemini manager not initialized")
	}
	binary := a.geminiManager.GetBinaryPath()
	if strings.TrimSpace(binary) == "" {
		return "", fmt.Errorf("gemini CLI binary not found; run `gemini --version` to verify install")
	}

	args := []string{"--approval-mode", "yolo"}
	if model != "" {
		args = append(args, "-m", model)
	}
	args = append(args, "-p", prompt)

	runCtx, cancel := context.WithTimeout(ctx, sessionTitleCLITimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, binary, args...)
	cmd.Dir = resolveCLIWorkingDir(projectPath)
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("gemini CLI failed: %w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// extractCodexAssistantText scans Codex JSONL output for the latest agent
// message text content.
func extractCodexAssistantText(stdout string) string {
	var lastText string
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		var event map[string]interface{}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		eventType, _ := event["type"].(string)
		if eventType != "item.completed" {
			continue
		}
		item, ok := event["item"].(map[string]interface{})
		if !ok {
			continue
		}
		itemType, _ := item["type"].(string)
		if itemType == "" {
			itemType, _ = item["item_type"].(string)
		}
		if itemType != "agent_message" && itemType != "assistant_message" {
			continue
		}
		if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
			lastText = text
		}
	}
	return strings.TrimSpace(lastText)
}


// GenerateSessionTitle generates a title for a new session from its first prompt.
// Falls back to prompt-derived title if API is not configured or fails.
func (a *App) GenerateSessionTitle(prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", nil
	}

	apiURL, apiKey, model, _, _ := a.loadTitleAPIConfig()
	if apiURL == "" || apiKey == "" || model == "" {
		return fallbackSessionTitleFromPrompt(prompt), nil
	}

	title, err := a.runDirectAPIForTitle(a.ctx, model, sessionTitleSystemPrompt, prompt)
	if err != nil {
		log.Printf("[SessionTitle] generation failed: %v", err)
		return fallbackSessionTitleFromPrompt(prompt), nil
	}
	title = cleanGeneratedSessionTitle(title)
	if title == "" || isGenericTitle(title) {
		log.Printf("[SessionTitle] rejected generic title %q, using fallback", title)
		return fallbackSessionTitleFromPrompt(prompt), nil
	}
	return title, nil
}

// GenerateSessionTitleForSession reads the recent transcript of an existing
// session and asks the configured API to summarize the *current* focus.
func (a *App) GenerateSessionTitleForSession(provider, sessionID, projectID string) (string, error) {
	provider = strings.TrimSpace(provider)
	sessionID = strings.TrimSpace(sessionID)
	projectID = strings.TrimSpace(projectID)
	if provider == "" || sessionID == "" || projectID == "" {
		return "", fmt.Errorf("provider, sessionID and projectID are required")
	}

	apiURL, apiKey, model, _, _ := a.loadTitleAPIConfig()
	if apiURL == "" || apiKey == "" || model == "" {
		return "", fmt.Errorf("session title not configured (select a Provider and Model in Settings)")
	}

	messages, err := a.LoadProviderSessionHistory(sessionID, projectID, provider)
	if err != nil {
		return "", fmt.Errorf("load session history (provider=%s, session=%s, projectID=%s): %w", provider, sessionID, projectID, err)
	}
	transcript := buildRecentTranscript(messages)
	transcriptLen := utf8.RuneCountInString(strings.TrimSpace(transcript))
	if transcriptLen < 20 {
		return "", fmt.Errorf("session transcript too short (%d runes, %d messages loaded, provider=%s, projectID=%s)", transcriptLen, len(messages), provider, projectID)
	}

	log.Printf("[SessionTitle] regen %s/%s (projectID=%s): transcript %d runes, %d messages loaded", provider, sessionID, projectID, transcriptLen, len(messages))

	title, err := a.runDirectAPIForTitle(
		a.ctx,
		model,
		latestFocusTitleSystemPrompt,
		wrapTranscriptForTitling(
			transcript,
			"Below is a recent chat transcript. Output ONLY a short title (3-8 words) that names the user's CURRENT focus of work. Do not greet, do not explain, do not say you cannot help.",
		),
	)
	if err != nil {
		log.Printf("[SessionTitle] regen failed for %s/%s: %v", provider, sessionID, err)
		return "", err
	}
	title = cleanGeneratedSessionTitle(title)
	if title == "" || isGenericTitle(title) {
		return "", fmt.Errorf("model returned a generic/empty title %q — try again when the session has more content", title)
	}
	if saveErr := a.SaveGeneratedSessionTitle(provider, sessionID, title); saveErr != nil {
		log.Printf("[SessionTitle] persist failed for %s/%s: %v", provider, sessionID, saveErr)
	}
	return title, nil
}

var branchNameSlugRe = regexp.MustCompile(`[^a-z0-9]+`)
var branchNamePrefixRe = regexp.MustCompile(`^(feat|fix|chore|refactor|refac|docs|doc|test|ci|build|perf|style)\s*/`)

func sanitizeBranchName(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	raw = strings.Trim(raw, "\"'`“”‘’")
	raw = strings.Split(raw, "\n")[0]
	raw = branchNamePrefixRe.ReplaceAllString(raw, "")
	slug := branchNameSlugRe.ReplaceAllString(raw, "-")
	slug = strings.Trim(slug, "-")
	if utf8.RuneCountInString(slug) > maxBranchNameRunes {
		runes := []rune(slug)
		slug = strings.TrimRight(string(runes[:maxBranchNameRunes]), "-")
	}
	return slug
}

// GenerateBranchName picks the most recent session in a workspace and asks the
// configured API for a short kebab-case branch name describing the latest
// focus of work.
func (a *App) GenerateBranchName(projectPath string) (string, error) {
	projectPath = strings.TrimSpace(projectPath)
	if projectPath == "" {
		return "", fmt.Errorf("projectPath is required")
	}

	apiURL, apiKey, model, _, _ := a.loadTitleAPIConfig()
	if apiURL == "" || apiKey == "" || model == "" {
		return "", fmt.Errorf("session title not configured (select a Provider and Model in Settings)")
	}

	result, err := a.ListSpaceSessions(projectPath, 4)
	if err != nil {
		return "", fmt.Errorf("list workspace sessions: %w", err)
	}
	if len(result.Sessions) == 0 {
		return "", fmt.Errorf("no chat sessions found for this workspace")
	}

	var transcript string
	for _, s := range result.Sessions {
		messages, err := a.LoadProviderSessionHistory(s.ID, s.ProjectID, s.Provider)
		if err != nil {
			log.Printf("[BranchName] load history %s/%s failed: %v", s.Provider, s.ID, err)
			continue
		}
		t := buildRecentTranscript(messages)
		if t != "" {
			transcript = t
			break
		}
	}
	if transcript == "" {
		return "", fmt.Errorf("session transcript is empty")
	}

	raw, err := a.runDirectAPIForTitle(
		a.ctx,
		model,
		branchNameSystemPrompt,
		wrapTranscriptForTitling(
			transcript,
			"Below is a recent chat transcript. Output ONLY a kebab-case branch name (lowercase ASCII, 2-4 words, max 24 chars) describing the CURRENT focus of work. No prefixes, no quotes, no explanation.",
		),
	)
	if err != nil {
		return "", err
	}
	slug := sanitizeBranchName(raw)
	if slug == "" {
		return "", fmt.Errorf("API returned an unusable branch name: %q", raw)
	}
	return slug, nil
}

// RenameGitBranch renames the current branch of the workspace at projectPath
// to newBranch. Refuses to rename if the new name is empty or already taken.
func (a *App) RenameGitBranch(projectPath, newBranch string) (string, error) {
	projectPath = strings.TrimSpace(projectPath)
	newBranch = sanitizeBranchName(newBranch)
	if projectPath == "" {
		return "", fmt.Errorf("projectPath is required")
	}
	if newBranch == "" {
		return "", fmt.Errorf("new branch name is empty after sanitizing")
	}

	repo, err := git.Open(projectPath)
	if err != nil {
		return "", fmt.Errorf("open git repo: %w", err)
	}
	current, err := repo.CurrentBranch()
	if err != nil {
		return "", fmt.Errorf("get current branch: %w", err)
	}
	if current == newBranch {
		return current, nil
	}

	if existing, err := repo.RunGitCommand("rev-parse", "--verify", "--quiet", "refs/heads/"+newBranch); err == nil && strings.TrimSpace(existing) != "" {
		return "", fmt.Errorf("branch %q already exists", newBranch)
	}

	if _, err := repo.RunGitCommand("branch", "-m", newBranch); err != nil {
		return "", fmt.Errorf("rename branch: %w", err)
	}

	if err := a.NotifyBranchRenamed(projectPath, newBranch); err != nil {
		log.Printf("[BranchRename] notify rename failed for %s: %v", projectPath, err)
	}
	return newBranch, nil
}
