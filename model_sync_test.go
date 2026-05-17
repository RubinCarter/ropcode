package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"ropcode/internal/database"
	"ropcode/internal/models"
)

func newModelSyncTestApp(t *testing.T, serverURL string) *App {
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
		ID:         "codex-api",
		Name:       "Test Codex",
		ProviderID: "codex",
		BaseURL:    serverURL + "/v1",
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
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data": []map[string]string{
				{"id": "gpt-5.5"},
				{"id": "gpt-5.5-fast"},
				{"id": "dall-e-3"},
			},
		})
	}))
	defer server.Close()

	app := newModelSyncTestApp(t, server.URL)

	synced, err := app.SyncProviderModelsFromAPI("codex", "codex-api")
	if err != nil {
		t.Fatalf("SyncProviderModelsFromAPI failed: %v", err)
	}

	if gotAuth != "Bearer test-token" {
		t.Fatalf("expected bearer auth header, got %q", gotAuth)
	}
	if len(synced) != 0 {
		t.Fatalf("expected no new Codex models, got %d: %#v", len(synced), synced)
	}
	if _, err := app.modelRegistry.GetModelByModelID("gpt-5.5-fast"); err == nil {
		t.Fatal("expected unsupported Codex model gpt-5.5-fast to be filtered out")
	}
}
