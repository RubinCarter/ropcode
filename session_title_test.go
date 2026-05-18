package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"ropcode/internal/database"
)

func TestCleanGeneratedSessionTitle(t *testing.T) {
	got := cleanGeneratedSessionTitle("  \"Fix Wails session tabs.\"  \nextra text")
	if got != "Fix Wails session tabs" {
		t.Fatalf("cleanGeneratedSessionTitle() = %q", got)
	}
}

func TestFallbackSessionTitleFromPrompt(t *testing.T) {
	got := fallbackSessionTitleFromPrompt("  请帮我检查自动取标题为什么不可用，并且修复左侧会话列表刷新  ")
	if got != "请帮我检查自动取标题为什么不可用，并且修复左侧会话列表刷新" {
		t.Fatalf("fallbackSessionTitleFromPrompt() = %q", got)
	}
}

func TestSessionTitleStoreOverridesSummaryTitle(t *testing.T) {
	store := newSessionTitleStore()
	store.Set("claude", "session-1", "生成后的标题")

	summary := ProviderSessionSummary{
		ID:           "session-1",
		Provider:     "claude",
		Title:        "原始首条消息",
		FirstMessage: "原始首条消息",
	}

	got := applyStoredSessionTitle(summary, store)
	if got.Title != "生成后的标题" {
		t.Fatalf("title = %q, want stored generated title", got.Title)
	}
	if got.FirstMessage != "原始首条消息" {
		t.Fatalf("first message should stay as transcript preview, got %q", got.FirstMessage)
	}
}

func TestSaveGeneratedSessionTitlePersistsInSettings(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "ropcode.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()

	app := &App{dbManager: db, sessionTitles: newSessionTitleStore()}
	if err := app.SaveGeneratedSessionTitle("claude", "session-1", "生成后的标题"); err != nil {
		t.Fatalf("SaveGeneratedSessionTitle() error = %v", err)
	}

	raw, err := db.GetSetting(generatedSessionTitlesSettingKey)
	if err != nil {
		t.Fatalf("GetSetting() error = %v", err)
	}
	var persisted map[string]string
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		t.Fatalf("unmarshal persisted titles: %v", err)
	}
	if persisted["claude:session-1"] != "生成后的标题" {
		t.Fatalf("persisted title = %q, want generated title", persisted["claude:session-1"])
	}

	reloaded := &App{dbManager: db, sessionTitles: newSessionTitleStore()}
	reloaded.loadGeneratedSessionTitles()
	if got := reloaded.sessionTitles.Get("claude", "session-1"); got != "生成后的标题" {
		t.Fatalf("reloaded title = %q, want generated title", got)
	}
}

func TestGenerateSessionTitleWithConfigUsesOpenAICompatibleChatCompletions(t *testing.T) {
	var requestedPath string
	var requestedAuth string
	var requestBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		requestedAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"\"Wails session tabs\""}}]}`))
	}))
	defer server.Close()

	title, err := generateSessionTitleWithConfig(&database.ProviderApiConfig{
		BaseURL:   server.URL,
		AuthToken: "test-token",
	}, "title-model", "点击更多会话报错，顺便给这次会话起个标题")
	if err != nil {
		t.Fatalf("generateSessionTitleWithConfig() error = %v", err)
	}
	if title != "Wails session tabs" {
		t.Fatalf("generateSessionTitleWithConfig() = %q", title)
	}
	if requestedPath != "/chat/completions" {
		t.Fatalf("request path = %q, want /chat/completions", requestedPath)
	}
	if requestedAuth != "Bearer test-token" {
		t.Fatalf("Authorization = %q", requestedAuth)
	}
	if requestBody["model"] != "title-model" {
		t.Fatalf("model = %v", requestBody["model"])
	}
	messages, ok := requestBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("messages = %#v", requestBody["messages"])
	}
}

func TestGenerateSessionTitleWithConfigUsesAnthropicMessagesForClaude(t *testing.T) {
	var requestedPath string
	var requestedKey string
	var requestedVersion string
	var requestBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.Path
		requestedKey = r.Header.Get("x-api-key")
		requestedVersion = r.Header.Get("anthropic-version")
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"Claude naming service"}]}`))
	}))
	defer server.Close()

	title, err := generateSessionTitleWithConfig(&database.ProviderApiConfig{
		ProviderID: "claude",
		BaseURL:    server.URL,
		AuthToken:  "anthropic-token",
	}, "claude-3-5-haiku-20241022", "上面的会话无法关闭，取名服务没触发")
	if err != nil {
		t.Fatalf("generateSessionTitleWithConfig() error = %v", err)
	}
	if title != "Claude naming service" {
		t.Fatalf("generateSessionTitleWithConfig() = %q", title)
	}
	if requestedPath != "/v1/messages" {
		t.Fatalf("request path = %q, want /v1/messages", requestedPath)
	}
	if requestedKey != "anthropic-token" {
		t.Fatalf("x-api-key = %q", requestedKey)
	}
	if requestedVersion == "" {
		t.Fatalf("anthropic-version header was empty")
	}
	if requestBody["model"] != "claude-3-5-haiku-20241022" {
		t.Fatalf("model = %v", requestBody["model"])
	}
}
