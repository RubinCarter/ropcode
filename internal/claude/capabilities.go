package claude

import "strings"

type CapabilityKind string

const (
	CapabilityKindCommand CapabilityKind = "command"
	CapabilityKindSkill   CapabilityKind = "skill"
)

type CapabilityScope string

const (
	CapabilityScopeSystem  CapabilityScope = "system"
	CapabilityScopeUser    CapabilityScope = "user"
	CapabilityScopeProject CapabilityScope = "project"
)

type CommandSummary struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	ArgumentHint string `json:"argument_hint"`
}

type CapabilitySnapshot struct {
	Stage    string           `json:"stage"`
	Commands []CommandSummary `json:"commands"`
	Skills   []string         `json:"skills"`
}

type ClaudeCapability struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	SlashName    string `json:"slash_name"`
	Kind         string `json:"kind"`
	Description  string `json:"description,omitempty"`
	ArgumentHint string `json:"argument_hint,omitempty"`
	Scope        string `json:"scope"`
}

type CapabilityLayers struct {
	System      []ClaudeCapability `json:"system"`
	UserOnly    []ClaudeCapability `json:"user_only"`
	ProjectOnly []ClaudeCapability `json:"project_only"`
	AllVisible  []ClaudeCapability `json:"all_visible"`
}

func normalizeCapabilities(commands []CommandSummary, skills []string, scope CapabilityScope) []ClaudeCapability {
	capabilities := make([]ClaudeCapability, 0, len(commands)+len(skills))

	for _, command := range commands {
		name := strings.TrimPrefix(strings.TrimSpace(command.Name), "/")
		if name == "" {
			continue
		}
		capabilities = append(capabilities, ClaudeCapability{
			Key:          capabilityKey(string(CapabilityKindCommand), name),
			Name:         name,
			SlashName:    "/" + name,
			Kind:         string(CapabilityKindCommand),
			Description:  command.Description,
			ArgumentHint: command.ArgumentHint,
			Scope:        string(scope),
		})
	}

	for _, skill := range skills {
		name := strings.TrimPrefix(strings.TrimSpace(skill), "/")
		if name == "" {
			continue
		}
		capabilities = append(capabilities, ClaudeCapability{
			Key:       capabilityKey(string(CapabilityKindSkill), name),
			Name:      name,
			SlashName: "/" + name,
			Kind:      string(CapabilityKindSkill),
			Scope:     string(scope),
		})
	}

	return dedupeCapabilities(capabilities)
}

func capabilityKey(kind, name string) string {
	cleanKind := strings.TrimSpace(kind)
	cleanName := strings.TrimPrefix(strings.TrimSpace(name), "/")
	return cleanKind + ":" + cleanName
}

func dedupeCapabilities(capabilities []ClaudeCapability) []ClaudeCapability {
	seen := make(map[string]struct{}, len(capabilities))
	result := make([]ClaudeCapability, 0, len(capabilities))

	for _, capability := range capabilities {
		capability.Name = strings.TrimPrefix(strings.TrimSpace(capability.Name), "/")
		capability.SlashName = strings.TrimSpace(capability.SlashName)
		if capability.Name == "" {
			capability.Name = strings.TrimPrefix(strings.TrimSpace(capability.SlashName), "/")
		}
		if capability.SlashName == "" && capability.Name != "" {
			capability.SlashName = "/" + capability.Name
		}
		if capability.Key == "" {
			capability.Key = capabilityKey(capability.Kind, capability.Name)
		}
		if capability.Key == ":" || capability.Name == "" {
			continue
		}
		if _, ok := seen[capability.Key]; ok {
			continue
		}
		seen[capability.Key] = struct{}{}
		result = append(result, capability)
	}

	return result
}
