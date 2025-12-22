// internal/models/builtin.go
package models

import (
	"ropcode/internal/database"
)

// BuiltinModels returns the list of built-in model configurations
// These are immutable and cannot be modified or deleted by users
func BuiltinModels() []*database.ModelConfig {
	return []*database.ModelConfig{
		// Claude models - use prompt engineering for thinking depth
		// Budget field stores the phrase to append to prompts
		{
			ModelID:     "sonnet",
			ProviderID:  "claude",
			DisplayName: "Claude Sonnet 4",
			Description: "Fast and capable, recommended for coding tasks",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   true, // Default for Claude
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true}, // No phrase = let Claude decide
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
				{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
				{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
			},
		},
		{
			ModelID:     "opus",
			ProviderID:  "claude",
			DisplayName: "Claude Opus 4.5",
			Description: "Most capable flagship model for complex tasks",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true}, // No phrase = let Claude decide
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
				{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
				{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
			},
		},
		{
			ModelID:     "haiku",
			ProviderID:  "claude",
			DisplayName: "Claude Haiku 3.5",
			Description: "Fastest model for simple tasks",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{}, // No thinking support
		},

		// Codex/OpenAI models - use native reasoning_effort parameter
		{
			ModelID:     "gpt-5.1-codex-max",
			ProviderID:  "codex",
			DisplayName: "GPT-5.1 Codex Max",
			Description: "Maximum reasoning model with deepest analysis",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   true, // Default for Codex
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "low", Name: "Low", Budget: "low", IsDefault: false},
				{ID: "medium", Name: "Medium", Budget: "medium", IsDefault: true},
				{ID: "high", Name: "High", Budget: "high", IsDefault: false},
				{ID: "xhigh", Name: "Extra High", Budget: "xhigh", IsDefault: false},
			},
		},
		{
			ModelID:     "gpt-5.1-codex",
			ProviderID:  "codex",
			DisplayName: "GPT-5.1 Codex",
			Description: "Latest coding model with enhanced reasoning",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "medium", Name: "Medium", Budget: "medium", IsDefault: true},
				{ID: "minimal", Name: "Minimal", Budget: "minimal", IsDefault: false},
				{ID: "low", Name: "Low", Budget: "low", IsDefault: false},
				{ID: "high", Name: "High", Budget: "high", IsDefault: false},
			},
		},
		{
			ModelID:     "gpt-5.1-codex-mini",
			ProviderID:  "codex",
			DisplayName: "GPT-5.1 Codex Mini",
			Description: "Faster variant of GPT-5.1 Codex",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "medium", Name: "Medium", Budget: "medium", IsDefault: true},
				{ID: "minimal", Name: "Minimal", Budget: "minimal", IsDefault: false},
				{ID: "low", Name: "Low", Budget: "low", IsDefault: false},
				{ID: "high", Name: "High", Budget: "high", IsDefault: false},
			},
		},
		{
			ModelID:     "gpt-5.1",
			ProviderID:  "codex",
			DisplayName: "GPT-5.1",
			Description: "Latest general purpose model",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "medium", Name: "Medium", Budget: "medium", IsDefault: true},
				{ID: "minimal", Name: "Minimal", Budget: "minimal", IsDefault: false},
				{ID: "low", Name: "Low", Budget: "low", IsDefault: false},
				{ID: "high", Name: "High", Budget: "high", IsDefault: false},
			},
		},

		// Gemini models - use Claude-style prompt engineering for thinking depth
		{
			ModelID:     "auto",
			ProviderID:  "gemini",
			DisplayName: "Auto",
			Description: "Let the system automatically choose the best model",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   true, // Default for Gemini
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true},
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
				{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
				{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
			},
		},
		{
			ModelID:     "gemini-2.5-pro",
			ProviderID:  "gemini",
			DisplayName: "Gemini 2.5 Pro",
			Description: "For complex tasks requiring deep reasoning and creativity",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true},
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
				{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
				{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
			},
		},
		{
			ModelID:     "gemini-2.5-flash",
			ProviderID:  "gemini",
			DisplayName: "Gemini 2.5 Flash",
			Description: "For tasks requiring a balance of speed and reasoning",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true},
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
				{ID: "think_harder", Name: "Think Harder", Budget: "think harder", IsDefault: false},
				{ID: "ultrathink", Name: "Ultrathink", Budget: "ultrathink", IsDefault: false},
			},
		},
		{
			ModelID:     "gemini-2.5-flash-lite",
			ProviderID:  "gemini",
			DisplayName: "Gemini 2.5 Flash Lite",
			Description: "For simple, quick tasks",
			IsBuiltin:   true,
			IsEnabled:   true,
			IsDefault:   false,
			ThinkingLevels: []database.ThinkingLevel{
				{ID: "auto", Name: "Auto", Budget: "", IsDefault: true},
				{ID: "think", Name: "Think", Budget: "think", IsDefault: false},
				{ID: "think_hard", Name: "Think Hard", Budget: "think hard", IsDefault: false},
			},
		},
	}
}

// GetBuiltinModel returns a builtin model by model_id
func GetBuiltinModel(modelID string) *database.ModelConfig {
	for _, model := range BuiltinModels() {
		if model.ModelID == modelID {
			return model
		}
	}
	return nil
}

// GetBuiltinModelsByProvider returns all builtin models for a provider
func GetBuiltinModelsByProvider(providerID string) []*database.ModelConfig {
	var models []*database.ModelConfig
	for _, model := range BuiltinModels() {
		if model.ProviderID == providerID {
			models = append(models, model)
		}
	}
	return models
}
