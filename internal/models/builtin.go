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
			ModelID:     "sonnet[1m]",
			ProviderID:  "claude",
			DisplayName: "Claude Sonnet 4 [1M]",
			Description: "Fast and capable with 1M token context window",
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
			ModelID:     "opus[1m]",
			ProviderID:  "claude",
			DisplayName: "Claude Opus 4.5 [1M]",
			Description: "Most capable flagship model with 1M token context window",
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
			ModelID:        "haiku",
			ProviderID:     "claude",
			DisplayName:    "Claude Haiku 3.5",
			Description:    "Fastest model for simple tasks",
			IsBuiltin:      true,
			IsEnabled:      true,
			IsDefault:      false,
			ThinkingLevels: []database.ThinkingLevel{}, // No thinking support
		},

		// Codex/OpenAI models - use native reasoning_effort parameter
		{
			ModelID:        "gpt-5.5",
			ProviderID:     "codex",
			DisplayName:    "GPT-5.5",
			Description:    "Recommended Codex model for most software engineering tasks",
			IsBuiltin:      true,
			IsEnabled:      true,
			IsDefault:      true, // Default for Codex
			ThinkingLevels: codexThinkingLevels(),
		},

		// Gemini models - use Claude-style prompt engineering for thinking depth
		{
			ModelID:     "gemini-3-pro",
			ProviderID:  "gemini",
			DisplayName: "Gemini 3 Pro",
			Description: "Latest flagship model for complex tasks",
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
			ModelID:     "gemini-3-flash",
			ProviderID:  "gemini",
			DisplayName: "Gemini 3 Flash",
			Description: "Fast and capable latest generation model",
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
			Description: "For complex tasks requiring deep reasoning",
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
			Description: "Balance of speed and reasoning",
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
	models := make([]*database.ModelConfig, 0)
	for _, model := range BuiltinModels() {
		if model.ProviderID == providerID {
			models = append(models, model)
		}
	}
	return models
}
