// internal/models/registry.go
package models

import (
	"fmt"

	"github.com/google/uuid"
	"ropcode/internal/database"
)

// Registry manages model configurations
// Builtin models are returned directly from code, user-defined models are stored in database
type Registry struct {
	db *database.Database
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
// The is_default flag is updated based on user settings
func (r *Registry) GetAllModels() ([]*database.ModelConfig, error) {
	// Get user's default model choices per provider
	defaultModels := r.getDefaultModelChoices()

	// Copy builtin models and update is_default based on user settings
	var result []*database.ModelConfig
	for _, m := range BuiltinModels() {
		// Create a copy to avoid modifying the original
		model := *m
		// Check if user has set a custom default for this provider
		if customDefault, ok := defaultModels[model.ProviderID]; ok {
			model.IsDefault = (model.ModelID == customDefault)
		}
		result = append(result, &model)
	}

	// Get user-defined models from database
	userModels, err := r.db.GetAllModelConfigs()
	if err != nil {
		return result, nil // Return builtins even if DB fails
	}

	// Update is_default for user models too
	for _, m := range userModels {
		if customDefault, ok := defaultModels[m.ProviderID]; ok {
			m.IsDefault = (m.ModelID == customDefault)
		}
		result = append(result, m)
	}

	return result, nil
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

// GetEnabledModels returns only enabled model configs
func (r *Registry) GetEnabledModels() ([]*database.ModelConfig, error) {
	// Get user's default model choices per provider
	defaultModels := r.getDefaultModelChoices()
	var result []*database.ModelConfig

	// Add enabled builtin models
	for _, m := range BuiltinModels() {
		if m.IsEnabled {
			model := *m
			if customDefault, ok := defaultModels[model.ProviderID]; ok {
				model.IsDefault = (model.ModelID == customDefault)
			}
			result = append(result, &model)
		}
	}

	// Add enabled user-defined models from database
	userModels, err := r.db.GetEnabledModelConfigs()
	if err != nil {
		return result, nil // Return builtins even if DB fails
	}

	for _, m := range userModels {
		if customDefault, ok := defaultModels[m.ProviderID]; ok {
			m.IsDefault = (m.ModelID == customDefault)
		}
		result = append(result, m)
	}

	return result, nil
}

// GetModelsByProvider returns all models for a specific provider
func (r *Registry) GetModelsByProvider(providerID string) ([]*database.ModelConfig, error) {
	// Get user's default model choice for this provider
	customDefault, _ := r.db.GetSetting(defaultModelSettingKey(providerID))
	var result []*database.ModelConfig

	// Add builtin models for provider
	for _, m := range BuiltinModels() {
		if m.ProviderID == providerID {
			model := *m
			if customDefault != "" {
				model.IsDefault = (model.ModelID == customDefault)
			}
			result = append(result, &model)
		}
	}

	// Add user-defined models for provider from database
	userModels, err := r.db.GetModelConfigsByProvider(providerID)
	if err != nil {
		return result, nil // Return builtins even if DB fails
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
