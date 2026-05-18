package models

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"ropcode/internal/database"
)

func newTestRegistry(t *testing.T) *Registry {
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

	return NewRegistry(db)
}

func TestBuiltinCodexModelsIncludeLatestRecommendedModels(t *testing.T) {
	want := map[string]bool{
		"gpt-5.5": false,
	}
	blocked := map[string]bool{
		"gpt-5.4-nano":        true,
		"gpt-5.4":             true,
		"gpt-5.4-mini":        true,
		"gpt-5.3-codex":       true,
		"gpt-5.3-codex-spark": true,
		"gpt-5-mini":          true,
		"gpt-5-nano":          true,
		"gpt-5.2":             true,
		"gpt-5.1-codex-max":   true,
		"gpt-5.1-codex":       true,
		"gpt-5.1-codex-mini":  true,
		"gpt-5.1":             true,
	}

	var defaultModel string
	for _, model := range GetBuiltinModelsByProvider("codex") {
		if blocked[model.ModelID] || strings.HasPrefix(model.ModelID, "gpt-5.1") {
			t.Fatalf("outdated Codex model %q should not be builtin", model.ModelID)
		}
		if model.ModelID != "gpt-5.5" {
			t.Fatalf("unexpected Codex builtin model %q", model.ModelID)
		}
		if _, ok := want[model.ModelID]; ok {
			want[model.ModelID] = true
		}
		if model.IsDefault {
			defaultModel = model.ModelID
		}
		assertCodexThinkingLevels(t, model.ThinkingLevels)
	}

	for modelID, found := range want {
		if !found {
			t.Fatalf("expected builtin Codex model %q", modelID)
		}
	}
	if defaultModel != "gpt-5.5" {
		t.Fatalf("expected gpt-5.5 as default Codex model, got %q", defaultModel)
	}
}

func assertCodexThinkingLevels(t *testing.T, levels []database.ThinkingLevel) {
	t.Helper()

	var got []string
	var defaultLevel string
	for _, level := range levels {
		got = append(got, level.ID)
		if level.IsDefault {
			defaultLevel = level.ID
		}
	}
	want := []string{"none", "minimal", "low", "medium", "high", "xhigh"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected Codex thinking levels %v, got %v", want, got)
	}
	if defaultLevel != "medium" {
		t.Fatalf("expected medium as default Codex thinking level, got %q", defaultLevel)
	}
}

func TestSyncProviderModelsAddsMissingCodexModelsAndFiltersNonTextModels(t *testing.T) {
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("codex", []string{
		"gpt-5.5",
		"gpt-5.5-fast",
		"text-embedding-3-large",
		"gpt-4o-mini-transcribe",
	})
	if err != nil {
		t.Fatalf("SyncProviderModels failed: %v", err)
	}

	if len(synced) != 0 {
		t.Fatalf("expected no newly synced Codex models, got %d: %#v", len(synced), synced)
	}

	if _, err := registry.GetModelByModelID("text-embedding-3-large"); err == nil {
		t.Fatal("expected embedding model to be filtered out")
	}
	if _, err := registry.GetModelByModelID("gpt-4o-mini-transcribe"); err == nil {
		t.Fatal("expected transcription model to be filtered out")
	}
}
