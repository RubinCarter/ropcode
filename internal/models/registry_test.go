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
		"gpt-5.5",                // builtin alias → cloned as user-defined
		"gpt-5.5-fast",           // new chat-style model → synced
		"text-embedding-3-large", // embedding → filtered
		"gpt-4o-mini-transcribe", // transcription → filtered
		"dall-e-3",               // image → filtered
	})
	if err != nil {
		t.Fatalf("SyncProviderModels failed: %v", err)
	}

	got := map[string]*database.ModelConfig{}
	for _, m := range synced {
		got[m.ModelID] = m
	}
	for _, want := range []string{"gpt-5.5", "gpt-5.5-fast"} {
		if got[want] == nil {
			t.Fatalf("expected %q to be synced, got %v", want, keys(got))
		}
		if got[want].IsBuiltin {
			t.Fatalf("synced %q should not be marked builtin", want)
		}
		if got[want].ProviderID != "codex" {
			t.Fatalf("expected provider_id=codex on %q, got %q", want, got[want].ProviderID)
		}
	}
	// gpt-5.5 was cloned from the builtin, so it inherits the curated
	// display name rather than the auto-generated one.
	if got["gpt-5.5"].DisplayName != "GPT-5.5" {
		t.Fatalf("expected cloned gpt-5.5 to keep builtin display name, got %q", got["gpt-5.5"].DisplayName)
	}
	assertCodexThinkingLevels(t, got["gpt-5.5-fast"].ThinkingLevels)

	if _, err := registry.GetModelByModelID("text-embedding-3-large"); err == nil {
		t.Fatal("expected embedding model to be filtered out")
	}
	if _, err := registry.GetModelByModelID("gpt-4o-mini-transcribe"); err == nil {
		t.Fatal("expected transcription model to be filtered out")
	}
	if _, err := registry.GetModelByModelID("dall-e-3"); err == nil {
		t.Fatal("expected image model to be filtered out")
	}

	// Both synced models should be visible via the listing APIs.
	all, err := registry.GetModelsByProvider("codex")
	if err != nil {
		t.Fatalf("GetModelsByProvider failed: %v", err)
	}
	listed := map[string]bool{}
	for _, m := range all {
		listed[m.ModelID] = true
	}
	for _, want := range []string{"gpt-5.5", "gpt-5.5-fast"} {
		if !listed[want] {
			t.Fatalf("expected %q in GetModelsByProvider result, got %#v", want, all)
		}
	}
}

func TestSyncProviderModelsAddsClaudeModelsWithPromptThinkingLevels(t *testing.T) {
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("claude", []string{
		"claude-opus-4-7",
		"claude-sonnet-4-6",
		"claude-haiku-4-5-20251001",
		"sonnet", // builtin alias — cloned with builtin metadata
		"text-embedding-anthropic",
	})
	if err != nil {
		t.Fatalf("SyncProviderModels failed: %v", err)
	}

	got := map[string]*database.ModelConfig{}
	for _, m := range synced {
		got[m.ModelID] = m
	}

	for _, want := range []string{"claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "sonnet"} {
		if got[want] == nil {
			t.Fatalf("expected %q to be synced, got %v", want, keys(got))
		}
	}
	if got["text-embedding-anthropic"] != nil {
		t.Fatal("expected embedding model to be filtered out")
	}
	// Cloned-from-builtin entries keep the curated display name.
	if got["sonnet"].DisplayName != "Claude Sonnet 4" {
		t.Fatalf("expected cloned sonnet to keep builtin display name, got %q", got["sonnet"].DisplayName)
	}

	// Non-haiku models get the 5-level prompt thinking ladder (auto default).
	opus := got["claude-opus-4-7"]
	if len(opus.ThinkingLevels) != 5 {
		t.Fatalf("expected 5 thinking levels for opus, got %d", len(opus.ThinkingLevels))
	}
	if opus.ThinkingLevels[0].ID != "auto" || !opus.ThinkingLevels[0].IsDefault {
		t.Fatalf("expected auto/default first level, got %#v", opus.ThinkingLevels[0])
	}

	// haiku-class models get no thinking levels.
	haiku := got["claude-haiku-4-5-20251001"]
	if len(haiku.ThinkingLevels) != 0 {
		t.Fatalf("expected haiku to have no thinking levels, got %#v", haiku.ThinkingLevels)
	}
}

func TestSyncProviderModelsAcceptsGatewayModelIDsForClaude(t *testing.T) {
	// Anthropic-compatible gateways often return their own model ids
	// (deepseek-chat, kimi-*, glm-*) from /v1/models. Those should still be
	// synced — users intentionally point Claude Code at the gateway.
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("claude", []string{
		"deepseek-chat",
		"kimi-k2",
		"glm-4.6",
		"some-embedding-v3",
	})
	if err != nil {
		t.Fatalf("SyncProviderModels failed: %v", err)
	}

	got := map[string]bool{}
	for _, m := range synced {
		got[m.ModelID] = true
	}
	for _, want := range []string{"deepseek-chat", "kimi-k2", "glm-4.6"} {
		if !got[want] {
			t.Fatalf("expected %q to be synced", want)
		}
	}
	if got["some-embedding-v3"] {
		t.Fatal("expected embedding model to be filtered out")
	}
}

func TestSyncFiltersThinkingVariantsForClaudeGateways(t *testing.T) {
	// Some Anthropic-compatible gateways expose redundant "<id>-thinking"
	// variants alongside the base id. Claude Code already drives thinking
	// through its prompt-based thinking levels, so these duplicates are
	// pure noise and must be filtered out at sync time.
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("claude", []string{
		"claude-opus-4-5-20251101",
		"claude-opus-4-5-20251101-thinking",
		"claude-sonnet-4-6-20251020",
		"claude-sonnet-4-6-20251020-thinking",
	})
	if err != nil {
		t.Fatalf("SyncProviderModels: %v", err)
	}

	got := map[string]bool{}
	for _, m := range synced {
		got[m.ModelID] = true
	}
	for _, want := range []string{"claude-opus-4-5-20251101", "claude-sonnet-4-6-20251020"} {
		if !got[want] {
			t.Fatalf("expected %q to be synced, got %v", want, got)
		}
	}
	for _, blocked := range []string{"claude-opus-4-5-20251101-thinking", "claude-sonnet-4-6-20251020-thinking"} {
		if got[blocked] {
			t.Fatalf("expected %q to be filtered out", blocked)
		}
	}
}

func keys(m map[string]*database.ModelConfig) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestGetModelsByProviderHidesBuiltinAliasesAfterUserSync(t *testing.T) {
	registry := newTestRegistry(t)

	// Before sync: builtins are visible.
	before, err := registry.GetModelsByProvider("claude")
	if err != nil {
		t.Fatalf("GetModelsByProvider: %v", err)
	}
	if len(before) == 0 {
		t.Fatal("expected builtin claude models before any sync, got 0")
	}
	for _, m := range before {
		if !m.IsBuiltin {
			t.Fatalf("expected only builtins before sync, saw user model %#v", m)
		}
	}

	// Sync brings in precise IDs.
	if _, err := registry.SyncProviderModels("claude", []string{
		"claude-opus-4-7",
		"claude-sonnet-4-6",
	}); err != nil {
		t.Fatalf("SyncProviderModels: %v", err)
	}

	after, err := registry.GetModelsByProvider("claude")
	if err != nil {
		t.Fatalf("GetModelsByProvider: %v", err)
	}
	for _, m := range after {
		if m.IsBuiltin {
			t.Fatalf("expected builtin %q to be hidden after sync, still visible", m.ModelID)
		}
	}
	gotIDs := map[string]bool{}
	for _, m := range after {
		gotIDs[m.ModelID] = true
	}
	if !gotIDs["claude-opus-4-7"] || !gotIDs["claude-sonnet-4-6"] {
		t.Fatalf("expected synced models to remain visible, got %v", gotIDs)
	}
	// [1m] variants should be auto-generated as user-defined models.
	if !gotIDs["claude-opus-4-7[1m]"] || !gotIDs["claude-sonnet-4-6[1m]"] {
		t.Fatalf("expected auto-generated [1m] variants, got %v", gotIDs)
	}
}

func TestSyncPromotesDefaultOffBuiltinOntoFirstUserModel(t *testing.T) {
	// User's default was a builtin alias (opus); after sync we hide the
	// alias, so the default has to migrate. Pick the first user-defined
	// model — the user can change it manually afterward.
	registry := newTestRegistry(t)

	if err := registry.SetDefaultModel("opus"); err != nil {
		t.Fatalf("SetDefaultModel: %v", err)
	}
	if _, err := registry.SyncProviderModels("claude", []string{
		"claude-opus-4-7",
		"claude-sonnet-4-6",
	}); err != nil {
		t.Fatalf("SyncProviderModels: %v", err)
	}

	// Verify default has moved off the builtin.
	got, err := registry.GetDefaultModel("claude")
	if err != nil || got == nil {
		t.Fatalf("GetDefaultModel: %v %#v", err, got)
	}
	if got.IsBuiltin {
		t.Fatalf("expected default to be a user-defined model, got builtin %#v", got)
	}

	// And no builtins should appear in the listing.
	listed, err := registry.GetModelsByProvider("claude")
	if err != nil {
		t.Fatalf("GetModelsByProvider: %v", err)
	}
	for _, m := range listed {
		if m.IsBuiltin {
			t.Fatalf("expected all builtins hidden after sync, saw %#v", m)
		}
	}
}

func TestSyncAutoGenerates1MVariantsForSonnetAndOpus(t *testing.T) {
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("claude", []string{
		"claude-opus-4-7",
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-sonnet-4-5-20250929",
		"claude-haiku-4-5-20251001",
	})
	if err != nil {
		t.Fatalf("SyncProviderModels: %v", err)
	}

	got := map[string]*database.ModelConfig{}
	for _, m := range synced {
		got[m.ModelID] = m
	}

	// Opus 4-6+ and Sonnet 4-6+ should have [1m] variants.
	for _, want := range []string{"claude-opus-4-7[1m]", "claude-opus-4-6[1m]", "claude-sonnet-4-6[1m]"} {
		if got[want] == nil {
			t.Fatalf("expected %q to be auto-generated, got %v", want, keys(got))
		}
		if !strings.HasSuffix(got[want].DisplayName, "[1M]") {
			t.Fatalf("expected [1M] in display name, got %q", got[want].DisplayName)
		}
	}

	// Older sonnet (4-5) and haiku should NOT have [1m] variants.
	for _, blocked := range []string{"claude-sonnet-4-5-20250929[1m]", "claude-haiku-4-5-20251001[1m]"} {
		if got[blocked] != nil {
			t.Fatalf("expected %q to NOT be generated", blocked)
		}
	}
}

func TestSyncDoesNotChangeUserChosenDefaultWhenItIsAUserModel(t *testing.T) {
	// If the user explicitly picked a user-defined model as default, a
	// later sync must not silently reassign it.
	registry := newTestRegistry(t)

	if _, err := registry.SyncProviderModels("claude", []string{"claude-sonnet-4-6"}); err != nil {
		t.Fatalf("first SyncProviderModels: %v", err)
	}
	if err := registry.SetDefaultModel("claude-sonnet-4-6"); err != nil {
		t.Fatalf("SetDefaultModel: %v", err)
	}
	// Second sync brings in a model that would sort before sonnet alphabetically.
	if _, err := registry.SyncProviderModels("claude", []string{"claude-opus-4-7"}); err != nil {
		t.Fatalf("second SyncProviderModels: %v", err)
	}

	got, err := registry.GetDefaultModel("claude")
	if err != nil || got == nil {
		t.Fatalf("GetDefaultModel: %v %#v", err, got)
	}
	if got.ModelID != "claude-sonnet-4-6" {
		t.Fatalf("expected default to remain claude-sonnet-4-6, got %q", got.ModelID)
	}
}

func TestSyncRepairsDefaultWhenItPointsAtDeletedUserModel(t *testing.T) {
	// Edge case: user deleted the model their default pointed at, then
	// re-synced. Promote a valid first user-defined model so the default
	// stays usable.
	registry := newTestRegistry(t)

	syncedFirst, err := registry.SyncProviderModels("claude", []string{"claude-haiku-4-5"})
	if err != nil || len(syncedFirst) != 1 {
		t.Fatalf("seed sync failed: %v %d", err, len(syncedFirst))
	}
	if err := registry.SetDefaultModel("claude-haiku-4-5"); err != nil {
		t.Fatalf("SetDefaultModel: %v", err)
	}
	if err := registry.DeleteModel(syncedFirst[0].ID); err != nil {
		t.Fatalf("DeleteModel: %v", err)
	}

	// Now the default points at a removed entry. Re-sync brings in new
	// IDs and the default should heal.
	if _, err := registry.SyncProviderModels("claude", []string{"claude-opus-4-7"}); err != nil {
		t.Fatalf("repair SyncProviderModels: %v", err)
	}

	got, err := registry.GetDefaultModel("claude")
	if err != nil || got == nil {
		t.Fatalf("GetDefaultModel: %v %#v", err, got)
	}
	if got.ModelID != "claude-opus-4-7" {
		t.Fatalf("expected default to be promoted to claude-opus-4-7, got %q", got.ModelID)
	}
}

func TestGetAllModelsRestoresBuiltinsAfterAllUserModelsRemoved(t *testing.T) {
	// If the user clears every user-defined model for a provider, the
	// builtin convenience aliases should reappear.
	registry := newTestRegistry(t)

	synced, err := registry.SyncProviderModels("claude", []string{"claude-opus-4-7"})
	if err != nil || len(synced) != 2 {
		t.Fatalf("unexpected sync result: %d %v", len(synced), err)
	}
	for _, m := range synced {
		if err := registry.DeleteModel(m.ID); err != nil {
			t.Fatalf("DeleteModel(%s): %v", m.ModelID, err)
		}
	}

	all, err := registry.GetModelsByProvider("claude")
	if err != nil {
		t.Fatalf("GetModelsByProvider: %v", err)
	}
	var sawBuiltin bool
	for _, m := range all {
		if m.IsBuiltin {
			sawBuiltin = true
		}
	}
	if !sawBuiltin {
		t.Fatal("expected builtin claude models to be visible again after user models removed")
	}
}
