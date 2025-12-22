// internal/models/registry.go
package models

import (
	"fmt"

	"github.com/google/uuid"
	"ropcode/internal/database"
)

// Registry manages model configurations
type Registry struct {
	db *database.Database
}

// NewRegistry creates a new model registry
func NewRegistry(db *database.Database) *Registry {
	return &Registry{db: db}
}

// Initialize ensures all builtin models are in the database
// This should be called at application startup
func (r *Registry) Initialize() error {
	builtins := BuiltinModels()

	for _, builtin := range builtins {
		exists, err := r.db.ModelConfigExists(builtin.ModelID)
		if err != nil {
			return fmt.Errorf("failed to check model existence: %w", err)
		}

		if !exists {
			// Generate a UUID for the builtin model
			builtin.ID = uuid.New().String()
			if err := r.db.SaveModelConfig(builtin); err != nil {
				return fmt.Errorf("failed to save builtin model %s: %w", builtin.ModelID, err)
			}
		}
	}

	return nil
}

// GetAllModels returns all model configs (builtin + user-defined)
func (r *Registry) GetAllModels() ([]*database.ModelConfig, error) {
	return r.db.GetAllModelConfigs()
}

// GetEnabledModels returns only enabled model configs
func (r *Registry) GetEnabledModels() ([]*database.ModelConfig, error) {
	return r.db.GetEnabledModelConfigs()
}

// GetModelsByProvider returns all models for a specific provider
func (r *Registry) GetModelsByProvider(providerID string) ([]*database.ModelConfig, error) {
	return r.db.GetModelConfigsByProvider(providerID)
}

// GetModel returns a model config by ID
func (r *Registry) GetModel(id string) (*database.ModelConfig, error) {
	return r.db.GetModelConfig(id)
}

// GetModelByModelID returns a model config by model_id
func (r *Registry) GetModelByModelID(modelID string) (*database.ModelConfig, error) {
	return r.db.GetModelConfigByModelID(modelID)
}

// GetDefaultModel returns the default model for a provider
func (r *Registry) GetDefaultModel(providerID string) (*database.ModelConfig, error) {
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

	// Check if model_id already exists
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
	return r.db.DeleteModelConfig(id)
}

// SetModelEnabled enables or disables a model
func (r *Registry) SetModelEnabled(id string, enabled bool) error {
	return r.db.SetModelConfigEnabled(id, enabled)
}

// SetDefaultModel sets a model as the default for its provider
func (r *Registry) SetDefaultModel(id string) error {
	return r.db.SetModelConfigDefault(id)
}

// GetThinkingLevels returns the thinking levels for a model
func (r *Registry) GetThinkingLevels(modelID string) ([]database.ThinkingLevel, error) {
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
