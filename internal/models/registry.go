// internal/models/registry.go
package models

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"ropcode/internal/database"
)

// Registry manages model configurations
// Builtin models are returned directly from code, user-defined models are stored in database
type Registry struct {
	db *database.Database
}

// SyncProviderModels creates user-defined model configs for provider model IDs
// that are not already present as built-in or user-defined models.
//
// As a side-effect, when the provider's current default points at a builtin
// alias (which list views will hide once user-defined models exist), the
// default is auto-promoted to the first user-defined model for that
// provider. This keeps the UI showing a usable default after the very first
// sync, without requiring the user to click "Set as default" themselves.
// User-chosen defaults that already point at user-defined models are
// untouched.
func (r *Registry) SyncProviderModels(providerID string, modelIDs []string) ([]*database.ModelConfig, error) {
	synced := make([]*database.ModelConfig, 0)
	seen := make(map[string]bool)

	for _, rawID := range modelIDs {
		modelID := strings.TrimSpace(rawID)
		if modelID == "" || seen[modelID] || !isSupportedProviderModel(providerID, modelID) {
			continue
		}
		seen[modelID] = true

		exists, err := r.db.ModelConfigExists(modelID)
		if err != nil {
			return synced, err
		}
		if exists {
			continue
		}

		// If this id is also a built-in alias (e.g. "gpt-5.5", "opus[1m]"),
		// clone the builtin's curated metadata into a user-defined entry so
		// it stays visible after the post-sync builtin-hiding kicks in.
		// CLI behaviour is unchanged because the model_id is identical.
		if builtin := GetBuiltinModel(modelID); builtin != nil {
			cloned := *builtin
			cloned.ID = uuid.New().String()
			cloned.IsBuiltin = false
			cloned.IsDefault = false
			cloned.Description = "Synced from provider /v1/models"
			if err := r.db.SaveModelConfig(&cloned); err != nil {
				return synced, err
			}
			synced = append(synced, &cloned)
			continue
		}

		config := newSyncedModelConfig(providerID, modelID)
		if err := r.CreateModel(config); err != nil {
			return synced, err
		}
		synced = append(synced, config)
	}

	r.promoteDefaultIfBuiltin(providerID)
	return synced, nil
}

// promoteDefaultIfBuiltin moves the provider's default off a builtin alias
// onto the first user-defined model when one exists. No-op if the user has
// already chosen a user-defined default that still resolves.
func (r *Registry) promoteDefaultIfBuiltin(providerID string) {
	userModels, err := r.db.GetModelConfigsByProvider(providerID)
	if err != nil || len(userModels) == 0 {
		return
	}

	settingKey := defaultModelSettingKey(providerID)
	currentDefault, _ := r.db.GetSetting(settingKey)
	currentDefault = strings.TrimSpace(currentDefault)

	switch {
	case currentDefault == "":
		// No setting yet — builtin IsDefault flag would have applied, and
		// that builtin is about to be hidden. Promote.
	case GetBuiltinModel(currentDefault) != nil:
		// Default points at a builtin — about to be hidden. Promote.
	default:
		// Default points at something not in the builtin table; verify it
		// still exists as a user-defined model. If the user deleted it,
		// promote a fresh one.
		if _, lookupErr := r.db.GetModelConfigByModelID(currentDefault); lookupErr == nil {
			return
		}
	}

	if err := r.db.SaveSetting(settingKey, userModels[0].ModelID); err != nil {
		// Sync itself succeeded; treat the default-promotion failure as
		// non-fatal so the user still gets their synced models.
		return
	}
}

// nonChatModelTokens lists substrings that mark a model as non-chat (audio, image,
// embedding, moderation, etc.) or as a redundant variant we don't want users
// picking. Models containing any of these tokens are skipped during
// /v1/models sync regardless of provider.
//
// "thinking" is excluded because some Anthropic-compatible gateways expose a
// separate "<id>-thinking" variant alongside the regular id. The regular
// model already supports extended thinking through Claude Code's prompt-based
// thinking levels, so the "-thinking" copy is duplicate noise.
var nonChatModelTokens = []string{
	"audio",
	"dall-e",
	"embedding",
	"image",
	"moderation",
	"realtime",
	"search",
	"speech",
	"thinking",
	"transcribe",
	"tts",
	"whisper",
}

func isSupportedProviderModel(providerID, modelID string) bool {
	if strings.TrimSpace(providerID) == "" {
		return false
	}
	id := strings.ToLower(strings.TrimSpace(modelID))
	if id == "" {
		return false
	}
	for _, token := range nonChatModelTokens {
		if strings.Contains(id, token) {
			return false
		}
	}
	switch providerID {
	case "codex":
		// Accept OpenAI chat-style ids: "gpt-*" and reasoning "o*-*" families.
		return strings.HasPrefix(id, "gpt-") || strings.HasPrefix(id, "o")
	case "claude":
		// Anthropic-native ids start with "claude-". Anthropic-compatible gateways
		// often expose their own ids (e.g. deepseek-chat, kimi-*) through the
		// /v1/models endpoint — accept those too so users can sync from gateways.
		return true
	default:
		return true
	}
}

func newSyncedModelConfig(providerID, modelID string) *database.ModelConfig {
	return &database.ModelConfig{
		ModelID:        modelID,
		ProviderID:     providerID,
		DisplayName:    displayNameFromModelID(modelID),
		Description:    "Synced from provider /v1/models",
		IsEnabled:      true,
		ThinkingLevels: defaultThinkingLevelsForProvider(providerID, modelID),
	}
}

func defaultThinkingLevelsForProvider(providerID, modelID string) []database.ThinkingLevel {
	switch providerID {
	case "codex":
		return codexThinkingLevels()
	case "claude":
		// haiku-class models on Claude don't support extended thinking; mirror
		// the builtin haiku entry which has no thinking levels.
		if strings.Contains(strings.ToLower(modelID), "haiku") {
			return []database.ThinkingLevel{}
		}
		return claudePromptThinkingLevels()
	case "gemini":
		return claudePromptThinkingLevels()
	default:
		return []database.ThinkingLevel{}
	}
}

func claudePromptThinkingLevels() []database.ThinkingLevel {
	return []database.ThinkingLevel{
		{ID: "auto", Name: "Auto", Budget: "", IsDefault: true},
		{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
		{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
		{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
		{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
	}
}

func codexThinkingLevels() []database.ThinkingLevel {
	return []database.ThinkingLevel{
		{ID: "none", Name: "None", Budget: "none", IsDefault: false},
		{ID: "minimal", Name: "Minimal", Budget: "minimal", IsDefault: false},
		{ID: "low", Name: "Low", Budget: "low", IsDefault: false},
		{ID: "medium", Name: "Medium", Budget: "medium", IsDefault: true},
		{ID: "high", Name: "High", Budget: "high", IsDefault: false},
		{ID: "xhigh", Name: "Extra High", Budget: "xhigh", IsDefault: false},
	}
}

func displayNameFromModelID(modelID string) string {
	parts := strings.FieldsFunc(modelID, func(r rune) bool {
		return r == '-' || r == '_'
	})
	for i, part := range parts {
		switch strings.ToLower(part) {
		case "gpt":
			parts[i] = "GPT"
		case "o":
			parts[i] = "O"
		default:
			parts[i] = strings.ToUpper(part[:1]) + part[1:]
		}
	}
	return strings.Join(parts, " ")
}

// NewRegistry creates a new model registry
func NewRegistry(db *database.Database) *Registry {
	return &Registry{db: db}
}

// Initialize is called at application startup
func (r *Registry) Initialize() error {
	return nil
}

// GetAllModels returns all model configs (builtin + user-defined)
// The is_default flag is updated based on user settings.
//
// Builtin convenience aliases (e.g. "sonnet", "opus", "gpt-5.5") are hidden
// for any provider that has at least one user-defined model — once the user
// has synced or manually added precise model IDs, the aliases become noise.
// The aliases stay resolvable via GetModel/GetModelByModelID so anything
// that already references them (default settings, running sessions) keeps
// working.
func (r *Registry) GetAllModels() ([]*database.ModelConfig, error) {
	// Get user's default model choices per provider
	defaultModels := r.getDefaultModelChoices()

	// Get user-defined models from database first so we can decide which
	// builtins to hide.
	userModels, err := r.db.GetAllModelConfigs()
	if err != nil {
		userModels = nil
	}
	hasUserModels := providersWithUserModels(userModels)

	result := make([]*database.ModelConfig, 0)
	for _, m := range BuiltinModels() {
		if shouldHideBuiltin(m, hasUserModels, defaultModels) {
			continue
		}
		model := *m
		if customDefault, ok := defaultModels[model.ProviderID]; ok {
			model.IsDefault = (model.ModelID == customDefault)
		}
		result = append(result, &model)
	}

	for _, m := range userModels {
		if customDefault, ok := defaultModels[m.ProviderID]; ok {
			m.IsDefault = (m.ModelID == customDefault)
		}
		result = append(result, m)
	}

	return result, nil
}

// providersWithUserModels returns the set of provider IDs that have at least
// one user-defined model entry.
func providersWithUserModels(models []*database.ModelConfig) map[string]bool {
	out := make(map[string]bool, 4)
	for _, m := range models {
		if m == nil {
			continue
		}
		out[m.ProviderID] = true
	}
	return out
}

// shouldHideBuiltin reports whether a builtin entry should be filtered out
// of list responses. Builtins are hidden once the user has any user-defined
// model for that provider — the precise IDs replace the convenience aliases.
// SyncProviderModels takes care of moving the default off any builtin that
// would otherwise be hidden, so list views don't need to keep one around.
func shouldHideBuiltin(builtin *database.ModelConfig, hasUserModels map[string]bool, _ map[string]string) bool {
	return hasUserModels[builtin.ProviderID]
}

// getDefaultModelChoices returns a map of provider_id -> default model_id from settings
func (r *Registry) getDefaultModelChoices() map[string]string {
	defaults := make(map[string]string)
	providers := []string{"claude", "codex", "gemini"}
	for _, p := range providers {
		if val, err := r.db.GetSetting(defaultModelSettingKey(p)); err == nil && val != "" {
			defaults[p] = val
		}
	}
	return defaults
}

// GetEnabledModels returns only enabled model configs.
// Same builtin-hiding rule as GetAllModels applies.
func (r *Registry) GetEnabledModels() ([]*database.ModelConfig, error) {
	// Get user's default model choices per provider
	defaultModels := r.getDefaultModelChoices()
	result := make([]*database.ModelConfig, 0)

	// Add enabled user-defined models from database first to know which
	// providers have explicit IDs.
	userModels, err := r.db.GetEnabledModelConfigs()
	if err != nil {
		userModels = nil
	}
	hasUserModels := providersWithUserModels(userModels)

	// Add enabled builtin models, skipping ones whose provider already has
	// user-defined entries (unless that builtin is the current default).
	for _, m := range BuiltinModels() {
		if !m.IsEnabled || shouldHideBuiltin(m, hasUserModels, defaultModels) {
			continue
		}
		model := *m
		if customDefault, ok := defaultModels[model.ProviderID]; ok {
			model.IsDefault = (model.ModelID == customDefault)
		}
		result = append(result, &model)
	}

	for _, m := range userModels {
		if customDefault, ok := defaultModels[m.ProviderID]; ok {
			m.IsDefault = (m.ModelID == customDefault)
		}
		result = append(result, m)
	}

	return result, nil
}

// GetModelsByProvider returns all models for a specific provider.
// Same builtin-hiding rule as GetAllModels applies.
func (r *Registry) GetModelsByProvider(providerID string) ([]*database.ModelConfig, error) {
	customDefault, _ := r.db.GetSetting(defaultModelSettingKey(providerID))
	result := make([]*database.ModelConfig, 0)

	userModels, err := r.db.GetModelConfigsByProvider(providerID)
	if err != nil {
		userModels = nil
	}
	hasUserModels := map[string]bool{providerID: len(userModels) > 0}
	defaults := map[string]string{}
	if customDefault != "" {
		defaults[providerID] = customDefault
	}

	for _, m := range BuiltinModels() {
		if m.ProviderID != providerID {
			continue
		}
		if shouldHideBuiltin(m, hasUserModels, defaults) {
			continue
		}
		model := *m
		if customDefault != "" {
			model.IsDefault = (model.ModelID == customDefault)
		}
		result = append(result, &model)
	}

	for _, m := range userModels {
		if customDefault != "" {
			m.IsDefault = (m.ModelID == customDefault)
		}
		result = append(result, m)
	}

	return result, nil
}

// GetModel returns a model config by ID
// For builtin models, ID is the model_id; for user models, ID is the UUID
func (r *Registry) GetModel(id string) (*database.ModelConfig, error) {
	// Check builtin models first (use model_id as lookup)
	if builtin := GetBuiltinModel(id); builtin != nil {
		return builtin, nil
	}

	// Check database for user-defined model
	return r.db.GetModelConfig(id)
}

// GetModelByModelID returns a model config by model_id
func (r *Registry) GetModelByModelID(modelID string) (*database.ModelConfig, error) {
	// Check builtin models first
	if builtin := GetBuiltinModel(modelID); builtin != nil {
		return builtin, nil
	}

	// Check database for user-defined model
	return r.db.GetModelConfigByModelID(modelID)
}

// defaultModelSettingKey returns the settings key for storing a provider's default model
func defaultModelSettingKey(providerID string) string {
	return "default_model_" + providerID
}

// GetDefaultModel returns the default model for a provider
func (r *Registry) GetDefaultModel(providerID string) (*database.ModelConfig, error) {
	// First check if user has set a custom default via settings
	settingKey := defaultModelSettingKey(providerID)
	customDefault, err := r.db.GetSetting(settingKey)
	if err == nil && customDefault != "" {
		// Try to find the model by model_id
		model, err := r.GetModelByModelID(customDefault)
		if err == nil && model != nil {
			return model, nil
		}
	}

	// Fall back to builtin default
	for _, m := range BuiltinModels() {
		if m.ProviderID == providerID && m.IsDefault {
			return m, nil
		}
	}

	// Check database for user-defined default model
	return r.db.GetDefaultModelConfig(providerID)
}

// CreateModel creates a new user-defined model
func (r *Registry) CreateModel(config *database.ModelConfig) error {
	// Validate required fields
	if config.ModelID == "" {
		return fmt.Errorf("model_id is required")
	}
	if config.ProviderID == "" {
		return fmt.Errorf("provider_id is required")
	}
	if config.DisplayName == "" {
		return fmt.Errorf("display_name is required")
	}

	// Check if model_id conflicts with a builtin model
	if GetBuiltinModel(config.ModelID) != nil {
		return fmt.Errorf("model_id %s conflicts with a builtin model", config.ModelID)
	}

	// Check if model_id already exists in database
	exists, err := r.db.ModelConfigExists(config.ModelID)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("model with id %s already exists", config.ModelID)
	}

	// Generate UUID and set defaults
	config.ID = uuid.New().String()
	config.IsBuiltin = false // User-created models are never builtin
	config.IsEnabled = true

	return r.db.SaveModelConfig(config)
}

// UpdateModel updates a user-defined model (builtin models cannot be updated)
func (r *Registry) UpdateModel(id string, updates *database.ModelConfig) error {
	// Check if trying to update a builtin model
	if GetBuiltinModel(id) != nil {
		return fmt.Errorf("cannot modify builtin model")
	}

	existing, err := r.db.GetModelConfig(id)
	if err != nil {
		return err
	}

	if existing.IsBuiltin {
		return fmt.Errorf("cannot modify builtin model")
	}

	// Apply updates while preserving immutable fields
	updates.ID = existing.ID
	updates.IsBuiltin = false
	updates.CreatedAt = existing.CreatedAt

	return r.db.SaveModelConfig(updates)
}

// DeleteModel deletes a user-defined model (builtin models cannot be deleted)
func (r *Registry) DeleteModel(id string) error {
	// Check if trying to delete a builtin model
	if GetBuiltinModel(id) != nil {
		return fmt.Errorf("cannot delete builtin model")
	}

	return r.db.DeleteModelConfig(id)
}

// SetModelEnabled enables or disables a model
// For builtin models, this is a no-op (they are always enabled)
func (r *Registry) SetModelEnabled(id string, enabled bool) error {
	// Builtin models cannot have their enabled state changed
	if GetBuiltinModel(id) != nil {
		return fmt.Errorf("cannot change enabled state of builtin model")
	}

	return r.db.SetModelConfigEnabled(id, enabled)
}

// SetDefaultModel sets a model as the default for its provider
// Uses settings storage for both builtin and user-defined models
func (r *Registry) SetDefaultModel(id string) error {
	// Find the model to get its provider ID
	model, err := r.GetModelByModelID(id)
	if err != nil {
		return fmt.Errorf("model not found: %s", id)
	}
	if model == nil {
		return fmt.Errorf("model not found: %s", id)
	}

	// Save the default model choice in settings
	settingKey := defaultModelSettingKey(model.ProviderID)
	return r.db.SaveSetting(settingKey, model.ModelID)
}

// GetThinkingLevels returns the thinking levels for a model
func (r *Registry) GetThinkingLevels(modelID string) ([]database.ThinkingLevel, error) {
	// Check builtin models first
	if builtin := GetBuiltinModel(modelID); builtin != nil {
		return builtin.ThinkingLevels, nil
	}

	// Check database for user-defined model
	config, err := r.db.GetModelConfigByModelID(modelID)
	if err != nil {
		return nil, err
	}
	return config.ThinkingLevels, nil
}

// GetDefaultThinkingLevel returns the default thinking level for a model
func (r *Registry) GetDefaultThinkingLevel(modelID string) (*database.ThinkingLevel, error) {
	levels, err := r.GetThinkingLevels(modelID)
	if err != nil {
		return nil, err
	}

	for i := range levels {
		if levels[i].IsDefault {
			return &levels[i], nil
		}
	}

	// If no default, return first level if available
	if len(levels) > 0 {
		return &levels[0], nil
	}

	return nil, nil // No thinking levels available
}
