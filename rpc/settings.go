package rpc

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ropcode/internal/claude"
	"ropcode/internal/provider"
)

func SettingsHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"SaveSetting": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, d.DB.SaveSetting(argString(p, 0), argString(p, 1))
		},
		"GetSetting": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return "", nil
			}
			return d.DB.GetSetting(argString(p, 0))
		},
		"GetClaudeSettings": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			return claude.LoadSettings(filepath.Join(d.Config.ClaudeDir, "settings.json"))
		},
		"SaveClaudeSettings": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			settings := argObject[map[string]interface{}](p, 0)
			return nil, claude.SaveSettings(filepath.Join(d.Config.ClaudeDir, "settings.json"), settings)
		},
		"GetSystemPrompt": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return "", nil
			}
			return claude.GetSystemPrompt(d.Config.ClaudeDir)
		},
		"SaveSystemPrompt": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			return nil, claude.SaveSystemPrompt(d.Config.ClaudeDir, argString(p, 0))
		},
		"FindClaudeMdFiles": func(p json.RawMessage) (any, error) {
			return claude.FindClaudeMdFiles(argString(p, 0))
		},
		"ReadClaudeMdFile": func(p json.RawMessage) (any, error) {
			data, err := os.ReadFile(argString(p, 0))
			if err != nil {
				return "", err
			}
			return string(data), nil
		},
		"SaveClaudeMdFile": func(p json.RawMessage) (any, error) {
			return nil, os.WriteFile(argString(p, 0), []byte(argString(p, 1)), 0644)
		},
		"GetProviderSystemPrompt": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return "", nil
			}
			return claude.GetProviderSystemPrompt(d.Config.ClaudeDir, argString(p, 0))
		},
		"SaveProviderSystemPrompt": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return "", nil
			}
			return claude.SaveProviderSystemPrompt(d.Config.ClaudeDir, argString(p, 0), argString(p, 1))
		},
		"ListSlashCommands": func(p json.RawMessage) (any, error) {
			return listProviderSlashCommands(d, argString(p, 0))
		},
		"GetSlashCommand": func(p json.RawMessage) (any, error) {
			return getProviderSlashCommand(d, argString(p, 0), argString(p, 1))
		},
		"SaveSlashCommand": func(p json.RawMessage) (any, error) {
			return nil, saveProviderSlashCommand(d, argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3), argString(p, 4))
		},
		"DeleteSlashCommand": func(p json.RawMessage) (any, error) {
			return nil, deleteProviderSlashCommand(d, argString(p, 0), argString(p, 1), argString(p, 2), argString(p, 3))
		},
		"ListClaudeConfigAgents": func(p json.RawMessage) (any, error) {
			return claude.ListClaudeConfigAgents(argString(p, 0))
		},
		"GetClaudeConfigAgent": func(p json.RawMessage) (any, error) {
			return claude.GetClaudeAgent(argString(p, 0), argString(p, 1), argString(p, 2))
		},
		"SaveClaudeConfigAgent": func(p json.RawMessage) (any, error) {
			agent := argObject[claude.ClaudeAgent](p, 0)
			return nil, claude.SaveClaudeAgent(&agent, argString(p, 1))
		},
		"DeleteClaudeConfigAgent": func(p json.RawMessage) (any, error) {
			return nil, claude.DeleteClaudeAgent(argString(p, 0), argString(p, 1), argString(p, 2))
		},
	}
}

func listProviderSlashCommands(d *Deps, projectPath string) ([]claude.SlashCommand, error) {
	if d.Provider == nil {
		return []claude.SlashCommand{}, nil
	}

	providerIDs := []string{"claude", "codex", "gemini", "deepseek", "pi"}
	commands := make([]claude.SlashCommand, 0)
	for _, providerID := range providerIDs {
		layers, err := d.Provider.GetProviderCapabilities(providerID, projectPath)
		if err != nil {
			continue
		}
		for _, capability := range layers.AllVisible {
			if capability.Kind != string(provider.CapabilityKindCommand) {
				continue
			}
			commands = append(commands, providerCapabilityToSlashCommand(providerID, capability))
		}
	}
	return commands, nil
}

func getProviderSlashCommand(d *Deps, name, projectPath string) (*claude.SlashCommand, error) {
	commands, err := listProviderSlashCommands(d, projectPath)
	if err != nil {
		return nil, err
	}
	for _, command := range commands {
		if command.ID == name || command.Name == name || command.FullCommand == name || command.FullCommand == "/"+name {
			return &command, nil
		}
	}
	return nil, fmt.Errorf("command not found: %s", name)
}

func saveProviderSlashCommand(d *Deps, providerID, name, content, scope, projectPath string) error {
	if d.Provider == nil {
		return fmt.Errorf("provider manager is not available")
	}
	if providerID == "" {
		providerID = string(claude.CommandTypeClaude)
	}
	return d.Provider.SaveProviderCapability(providerID, provider.Capability{
		Name:    name,
		Kind:    string(provider.CapabilityKindCommand),
		Scope:   providerSlashCommandScope(scope),
		Content: content,
	}, projectPath)
}

func deleteProviderSlashCommand(d *Deps, providerID, name, scope, projectPath string) error {
	if d.Provider == nil {
		return fmt.Errorf("provider manager is not available")
	}
	if providerID == "" {
		providerID = string(claude.CommandTypeClaude)
	}
	return d.Provider.DeleteProviderCapability(providerID, provider.Capability{
		Name:  name,
		Kind:  string(provider.CapabilityKindCommand),
		Scope: providerSlashCommandScope(scope),
	}, projectPath)
}

func providerSlashCommandScope(scope string) string {
	switch scope {
	case "global":
		return string(provider.CapabilityScopeUser)
	default:
		return scope
	}
}

func providerCapabilityToSlashCommand(providerID string, capability provider.Capability) claude.SlashCommand {
	scope := capability.Scope
	if scope == string(provider.CapabilityScopeSystem) {
		scope = "default"
	}
	command := claude.SlashCommand{
		ID:               capability.Key,
		CommandType:      claude.CommandType(providerID),
		Name:             capability.Name,
		FullCommand:      capability.SlashName,
		Scope:            scope,
		Namespace:        capability.Namespace,
		FilePath:         capability.SourcePath,
		Content:          capability.Content,
		AllowedTools:     append([]string(nil), capability.AllowedTools...),
		HasBashCommands:  capability.HasBashCommands,
		HasFileRefs:      capability.HasFileRefs,
		AcceptsArguments: capability.AcceptsArguments,
		PluginID:         capability.PluginID,
		PluginName:       capability.PluginName,
	}
	if capability.Description != "" {
		description := capability.Description
		command.Description = &description
	}
	if capability.ArgumentHint != "" {
		argumentHint := capability.ArgumentHint
		command.ArgumentHint = &argumentHint
	}
	return command
}

func HookHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"GetHooks": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			return claude.GetHooks(d.Config.ClaudeDir)
		},
		"SaveHooks": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			hooks := argObject[claude.HooksConfig](p, 0)
			return nil, claude.SaveHooks(d.Config.ClaudeDir, &hooks)
		},
		"GetHooksByType": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			return claude.GetHooksByType(d.Config.ClaudeDir, argString(p, 0))
		},
		"ValidateHookCommand": func(p json.RawMessage) (any, error) {
			cmd := argString(p, 0)
			if cmd == "" {
				return map[string]any{"valid": false, "message": "Command cannot be empty"}, nil
			}
			parts := strings.Fields(cmd)
			if len(parts) == 0 {
				return map[string]any{"valid": false, "message": "Command cannot be empty"}, nil
			}
			executable := parts[0]
			if filepath.IsAbs(executable) {
				if _, err := os.Stat(executable); err != nil {
					return map[string]any{"valid": false, "message": fmt.Sprintf("Executable not found: %s", executable)}, nil
				}
				return map[string]any{"valid": true, "message": "Command is valid"}, nil
			}
			if _, err := exec.LookPath(executable); err != nil {
				return map[string]any{"valid": false, "message": fmt.Sprintf("Command not found in PATH: %s", executable)}, nil
			}
			return map[string]any{"valid": true, "message": "Command is valid"}, nil
		},
		"GetMergedHooksConfig": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return &claude.HooksConfig{}, nil
			}
			globalHooks, err := claude.GetHooks(d.Config.ClaudeDir)
			if err != nil {
				globalHooks = &claude.HooksConfig{}
			}
			projectPath := argString(p, 0)
			if projectPath == "" {
				return globalHooks, nil
			}
			projectSettingsPath := filepath.Join(projectPath, ".claude", "settings.json")
			projectSettings, err := claude.LoadSettings(projectSettingsPath)
			if err != nil || projectSettings == nil {
				return globalHooks, nil
			}
			hooksData, ok := projectSettings["hooks"]
			if !ok {
				return globalHooks, nil
			}
			hooksJSON, err := json.Marshal(hooksData)
			if err != nil {
				return globalHooks, nil
			}
			var projectHooks claude.HooksConfig
			if err := json.Unmarshal(hooksJSON, &projectHooks); err != nil {
				return globalHooks, nil
			}
			return mergeHooksConfigs(globalHooks, &projectHooks), nil
		},
	}
}

func mergeHooksConfigs(global, project *claude.HooksConfig) *claude.HooksConfig {
	if project == nil {
		return global
	}
	if global == nil {
		return project
	}
	merged := *global
	if project.PreToolUse != nil {
		merged.PreToolUse = append(merged.PreToolUse, project.PreToolUse...)
	}
	if project.PostToolUse != nil {
		merged.PostToolUse = append(merged.PostToolUse, project.PostToolUse...)
	}
	if project.Notification != nil {
		merged.Notification = append(merged.Notification, project.Notification...)
	}
	if project.Stop != nil {
		merged.Stop = append(merged.Stop, project.Stop...)
	}
	return &merged
}
