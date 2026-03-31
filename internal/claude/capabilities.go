package claude

import (
	"sort"
	"strings"
)

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

func BuildCapabilityLayers(system, user, project CapabilitySnapshot) CapabilityLayers {
	systemCaps := normalizeCapabilities(system.Commands, system.Skills, CapabilityScopeSystem)
	userCaps := normalizeCapabilities(user.Commands, user.Skills, CapabilityScopeUser)
	projectCaps := normalizeCapabilities(project.Commands, project.Skills, CapabilityScopeProject)

	userOnly := capabilityDiff(userCaps, systemCaps)
	projectOnly := capabilityDiff(projectCaps, userCaps)
	allVisible := dedupeCapabilities(append(append([]ClaudeCapability{}, systemCaps...), append(userOnly, projectOnly...)...))

	sortCapabilities(systemCaps)
	sortCapabilities(userOnly)
	sortCapabilities(projectOnly)
	sortCapabilities(allVisible)

	return CapabilityLayers{
		System:      systemCaps,
		UserOnly:    userOnly,
		ProjectOnly: projectOnly,
		AllVisible:  allVisible,
	}
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

func capabilityDiff(current, base []ClaudeCapability) []ClaudeCapability {
	baseKeys := make(map[string]struct{}, len(base))
	for _, capability := range base {
		baseKeys[capability.Key] = struct{}{}
	}

	result := make([]ClaudeCapability, 0, len(current))
	for _, capability := range current {
		if _, ok := baseKeys[capability.Key]; ok {
			continue
		}
		result = append(result, capability)
	}

	return dedupeCapabilities(result)
}

func sortCapabilities(capabilities []ClaudeCapability) {
	sort.Slice(capabilities, func(i, j int) bool {
		left := capabilities[i]
		right := capabilities[j]

		if scopeOrder(left.Scope) != scopeOrder(right.Scope) {
			return scopeOrder(left.Scope) < scopeOrder(right.Scope)
		}
		if kindOrder(left.Kind) != kindOrder(right.Kind) {
			return kindOrder(left.Kind) < kindOrder(right.Kind)
		}
		return left.Name < right.Name
	})
}

func scopeOrder(scope string) int {
	switch scope {
	case string(CapabilityScopeSystem):
		return 0
	case string(CapabilityScopeUser):
		return 1
	case string(CapabilityScopeProject):
		return 2
	default:
		return 3
	}
}

func kindOrder(kind string) int {
	switch kind {
	case string(CapabilityKindCommand):
		return 0
	case string(CapabilityKindSkill):
		return 1
	default:
		return 2
	}
}
