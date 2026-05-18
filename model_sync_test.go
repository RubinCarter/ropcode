package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ropcode/internal/database"
	"ropcode/internal/models"
)

func newModelSyncTestApp(t *testing.T, providerID, baseURL string) *App {
	t.Helper()

	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close failed: %v", err)
		}
	})

	if err := db.SaveProviderApiConfig(&database.ProviderApiConfig{
		ID:         providerID + "-api",
		Name:       "Test " + providerID,
		ProviderID: providerID,
		BaseURL:    baseURL,
		AuthToken:  "test-token",
		IsDefault:  true,
	}); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}

	return &App{
		dbManager:     db,
		modelRegistry: models.NewRegistry(db),
	}
}

func TestSyncProviderModelsFromAPIUsesProviderConfigAndFiltersUnsupportedCodexModels(t *testing.T) {
	cases := map[string]string{
		"base url at host root":      "",
		"base url with trailing /v1": "/v1",
	}

	for name, suffix := range cases {
		t.Run(name, func(t *testing.T) {
			var (
				gotAuth string
				gotPath string
			)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotAuth = r.Header.Get("Authorization")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"object": "list",
					"data": []map[string]string{
						{"id": "gpt-5.5"},
						{"id": "gpt-5.5-fast"},
						{"id": "text-embedding-3-large"},
						{"id": "dall-e-3"},
					},
				})
			}))
			defer server.Close()

			app := newModelSyncTestApp(t, "codex", server.URL+suffix)

			synced, err := app.SyncProviderModelsFromAPI("codex", "codex-api")
			if err != nil {
				t.Fatalf("SyncProviderModelsFromAPI failed: %v", err)
			}

			wantPath := strings.TrimSuffix(suffix, "/v1") + "/v1/models"
			if gotPath != wantPath {
				t.Fatalf("expected GET %s, got %q", wantPath, gotPath)
			}
			if gotAuth != "Bearer test-token" {
				t.Fatalf("expected bearer auth header, got %q", gotAuth)
			}
			gotIDs := map[string]bool{}
			for _, m := range synced {
				gotIDs[m.ModelID] = true
			}
			// gpt-5.5 is a builtin alias — it gets cloned into a user-defined
			// entry so the synced list mirrors the gateway's /v1/models.
			// gpt-5.5-fast is a fresh chat-style id. Both should land.
			for _, want := range []string{"gpt-5.5", "gpt-5.5-fast"} {
				if !gotIDs[want] {
					t.Fatalf("expected %q to be synced, got %v", want, gotIDs)
				}
			}
			if _, err := app.modelRegistry.GetModelByModelID("text-embedding-3-large"); err == nil {
				t.Fatal("expected embedding model to be filtered out")
			}
			if _, err := app.modelRegistry.GetModelByModelID("dall-e-3"); err == nil {
				t.Fatal("expected image model to be filtered out")
			}
		})
	}
}

func TestSyncProviderModelsFromAPIClaudeUsesAnthropicHeaders(t *testing.T) {
	cases := map[string]string{
		"base url at host root":           "",        // becomes server.URL
		"base url with trailing /v1":      "/v1",     // OpenAI-style suffix
		"base url with anthropic gateway": "/anthropic", // gateway prefix without /v1
	}

	for name, suffix := range cases {
		t.Run(name, func(t *testing.T) {
			var (
				gotAPIKey  string
				gotVersion string
				gotPath    string
			)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotAPIKey = r.Header.Get("x-api-key")
				gotVersion = r.Header.Get("anthropic-version")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"data": []map[string]string{
						{"id": "claude-opus-4-7", "type": "model", "display_name": "Claude Opus 4.7"},
						{"id": "claude-sonnet-4-6", "type": "model", "display_name": "Claude Sonnet 4.6"},
						{"id": "claude-haiku-4-5-20251001", "type": "model", "display_name": "Claude Haiku 4.5"},
					},
				})
			}))
			defer server.Close()

			app := newModelSyncTestApp(t, "claude", server.URL+suffix)

			synced, err := app.SyncProviderModelsFromAPI("claude", "claude-api")
			if err != nil {
				t.Fatalf("SyncProviderModelsFromAPI failed: %v", err)
			}

			wantPath := strings.TrimSuffix(suffix, "/v1") + "/v1/models"
			if gotPath != wantPath {
				t.Fatalf("expected GET %s, got %q", wantPath, gotPath)
			}
			if gotAPIKey != "test-token" {
				t.Fatalf("expected x-api-key header, got %q", gotAPIKey)
			}
			if gotVersion != "2023-06-01" {
				t.Fatalf("expected anthropic-version header, got %q", gotVersion)
			}

			if len(synced) != 5 {
				t.Fatalf("expected 5 synced claude models (3 + 2 [1m] variants), got %d: %#v", len(synced), synced)
			}

			// Sanity-check thinking-level wiring: opus gets the 5-step prompt ladder,
			// haiku gets none.
			for _, m := range synced {
				if m.ModelID == "claude-haiku-4-5-20251001" && len(m.ThinkingLevels) != 0 {
					t.Fatalf("haiku should have no thinking levels, got %#v", m.ThinkingLevels)
					}
				if m.ModelID == "claude-opus-4-7" {
					if len(m.ThinkingLevels) != 5 || m.ThinkingLevels[0].ID != "auto" {
						t.Fatalf("opus should have 5 thinking levels with auto first, got %#v", m.ThinkingLevels)
					}
				}
			}
		})
	}
}

func TestSyncProviderModelsFromAPIClaudeFriendlyErrorOnMissingEndpoint(t *testing.T) {
	// Anthropic-compatible gateways (DeepSeek, Kimi, etc.) often expose
	// /anthropic/v1/messages but not /v1/models. The 404 should surface a
	// hint that the user should add models manually instead of leaking the
	// raw HTTP error.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	app := newModelSyncTestApp(t, "claude", server.URL)

	_, err := app.SyncProviderModelsFromAPI("claude", "claude-api")
	if err == nil {
		t.Fatal("expected error from missing /v1/models endpoint")
	}
	if !strings.Contains(err.Error(), "Add Model") {
		t.Fatalf("expected friendly hint mentioning 'Add Model', got %q", err)
	}
}

func TestSyncProviderModelsFromAPIClaudeFriendlyErrorOnHTMLResponse(t *testing.T) {
	// Some gateways return 200 OK + a landing/login HTML page when
	// /v1/models isn't implemented. We must not surface a JSON parse error;
	// instead point users at the manual flow.
	cases := map[string]http.HandlerFunc{
		"text/html content-type": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<!doctype html><html><body>login</body></html>"))
		},
		"html body without content-type": func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("\n  <html><head></head></html>"))
		},
	}

	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(handler)
			defer server.Close()

			app := newModelSyncTestApp(t, "claude", server.URL)

			_, err := app.SyncProviderModelsFromAPI("claude", "claude-api")
			if err == nil {
				t.Fatal("expected error from HTML response")
			}
			if !strings.Contains(err.Error(), "Add Model") {
				t.Fatalf("expected friendly hint mentioning 'Add Model', got %q", err)
			}
			if strings.Contains(err.Error(), "invalid character") {
				t.Fatalf("should not leak JSON parse error to user, got %q", err)
			}
		})
	}
}

func TestSyncProviderModelsFromAPIUsesGatewayConfigEvenWhenNotDefault(t *testing.T) {
	// Regression: when a user adds a gateway config but doesn't tick
	// "default", Sync was silently routing to the env-var fallback
	// (api.openai.com) and timing out. We must prefer any saved config for
	// the provider before reaching for OPENAI_API_KEY.
	// Isolate from the dev machine's real ~/.codex/config.toml — without
	// CODEX_HOME the resolver would read it and route past our DB config.
	t.Setenv("CODEX_HOME", t.TempDir())

	var hit bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("expected /v1/models, got %q", r.URL.Path)
		}
		hit = true
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"id": "gpt-5.4"}},
		})
	}))
	defer server.Close()

	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := db.SaveProviderApiConfig(&database.ProviderApiConfig{
		ID:         "codex-rucodes",
		Name:       "rucodes gateway",
		ProviderID: "codex",
		BaseURL:    server.URL,
		AuthToken:  "test-token",
		IsDefault:  false, // <- the failing case
	}); err != nil {
		t.Fatalf("SaveProviderApiConfig failed: %v", err)
	}

	app := &App{dbManager: db, modelRegistry: models.NewRegistry(db)}

	synced, err := app.SyncProviderModelsFromAPI("codex", "")
	if err != nil {
		t.Fatalf("SyncProviderModelsFromAPI failed: %v", err)
	}
	if !hit {
		t.Fatal("expected gateway server to be hit; sync routed elsewhere")
	}
	if len(synced) != 1 || synced[0].ModelID != "gpt-5.4" {
		t.Fatalf("expected gpt-5.4 to be synced via the gateway, got %#v", synced)
	}
}

func TestSyncProviderModelsFromAPIReadsCodexConfigToml(t *testing.T) {
	// Real-world scenario: user only configured codex via ~/.codex/config.toml
	// (its native config), never added a Ropcode-side ProviderApiConfig.
	// Sync should read codex's config and hit the gateway it points at.
	var hit bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("expected /v1/models, got %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-from-codex-auth" {
			t.Fatalf("expected Bearer token from auth.json, got %q", got)
		}
		hit = true
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"id": "gpt-5.4"}, {"id": "gpt-5.3-codex"}},
		})
	}))
	defer server.Close()

	codexHome := t.TempDir()
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(`
model_provider = "OpenAI"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "`+server.URL+`"
`), 0o600); err != nil {
		t.Fatalf("write config.toml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(`{"OPENAI_API_KEY":"sk-from-codex-auth"}`), 0o600); err != nil {
		t.Fatalf("write auth.json: %v", err)
	}
	t.Setenv("CODEX_HOME", codexHome)

	db, err := database.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	app := &App{dbManager: db, modelRegistry: models.NewRegistry(db)}

	synced, err := app.SyncProviderModelsFromAPI("codex", "")
	if err != nil {
		t.Fatalf("SyncProviderModelsFromAPI failed: %v", err)
	}
	if !hit {
		t.Fatal("expected sync to hit the gateway from codex config; routed elsewhere")
	}
	got := map[string]bool{}
	for _, m := range synced {
		got[m.ModelID] = true
	}
	if !got["gpt-5.4"] || !got["gpt-5.3-codex"] {
		t.Fatalf("expected both gpt-5.4 and gpt-5.3-codex to be synced, got %#v", synced)
	}
}
