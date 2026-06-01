package claude

import (
	"sort"
	"strings"
)

type CapabilityKind string

const (
	CapabilityKindCommand CapabilityKind = "command"
	CapabilityKindSkill   CapabilityKind = "skill"
	CapabilityKindAgent   CapabilityKind = "agent"
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
	Agents   []string         `json:"agents"`
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

func normalizeCapabilities(commands []CommandSummary, skills []string, agents []string, scope CapabilityScope) []ClaudeCapability {
	capabilities := make([]ClaudeCapability, 0, len(commands)+len(skills)+len(agents))

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

	for _, agent := range agents {
		name := strings.TrimPrefix(strings.TrimSpace(agent), "/")
		if name == "" {
			continue
		}
		capabilities = append(capabilities, ClaudeCapability{
			Key:       capabilityKey(string(CapabilityKindAgent), name),
			Name:      name,
			SlashName: "/" + name,
			Kind:      string(CapabilityKindAgent),
			Scope:     string(scope),
		})
	}

	return dedupeCapabilities(capabilities)
}

func BuildCapabilityLayersFromSnapshot(snapshot CapabilitySnapshot) CapabilityLayers {
	systemCaps := normalizeCapabilities(nil, snapshot.Skills, nil, CapabilityScopeSystem)
	userCaps := normalizeCapabilities(nil, nil, snapshot.Agents, CapabilityScopeUser)
	projectCaps := make([]ClaudeCapability, 0, len(snapshot.Commands))

	for _, command := range dedupeCommandSummaries(snapshot.Commands) {
		name := strings.TrimPrefix(strings.TrimSpace(command.Name), "/")
		scope := commandScopeFromCommand(name, command.Description)
		capability := normalizeCapabilities([]CommandSummary{command}, nil, nil, scope)
		if len(capability) == 0 {
			continue
		}
		switch scope {
		case CapabilityScopeSystem:
			systemCaps = append(systemCaps, capability[0])
		case CapabilityScopeProject:
			projectCaps = append(projectCaps, capability[0])
		default:
			userCaps = append(userCaps, capability[0])
		}
	}

	systemCaps = dedupeCapabilities(systemCaps)
	userCaps = dedupeCapabilities(userCaps)
	projectCaps = dedupeCapabilities(projectCaps)
	allVisible := dedupeCapabilities(append(append([]ClaudeCapability{}, systemCaps...), append(userCaps, projectCaps...)...))

	sortCapabilities(systemCaps)
	sortCapabilities(userCaps)
	sortCapabilities(projectCaps)
	sortCapabilities(allVisible)

	return CapabilityLayers{
		System:      systemCaps,
		UserOnly:    userCaps,
		ProjectOnly: projectCaps,
		AllVisible:  allVisible,
	}
}

func commandScopeFromCommand(name, description string) CapabilityScope {
	trimmed := strings.TrimSpace(description)
	if strings.HasSuffix(trimmed, "(project)") || strings.Contains(trimmed, "(project:") {
		return CapabilityScopeProject
	}
	if strings.HasSuffix(trimmed, "(user)") || strings.Contains(trimmed, "(user)") {
		return CapabilityScopeUser
	}
	return CapabilityScopeSystem
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
	case string(CapabilityKindAgent):
		return 1
	case string(CapabilityKindSkill):
		return 2
	default:
		return 3
	}
}
