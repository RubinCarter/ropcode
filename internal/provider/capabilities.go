package provider

import (
	"context"
	"sort"
	"strings"
	"time"
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
	CapabilityScopePlugin  CapabilityScope = "plugin"
)

type Capability struct {
	Key              string   `json:"key"`
	Provider         string   `json:"provider"`
	Name             string   `json:"name"`
	SlashName        string   `json:"slash_name"`
	Kind             string   `json:"kind"`
	Description      string   `json:"description,omitempty"`
	ArgumentHint     string   `json:"argument_hint,omitempty"`
	Scope            string   `json:"scope"`
	Namespace        *string  `json:"namespace,omitempty"`
	SourcePath       string   `json:"source_path,omitempty"`
	Content          string   `json:"content,omitempty"`
	AllowedTools     []string `json:"allowed_tools,omitempty"`
	HasBashCommands  bool     `json:"has_bash_commands,omitempty"`
	HasFileRefs      bool     `json:"has_file_references,omitempty"`
	AcceptsArguments bool     `json:"accepts_arguments,omitempty"`
	PluginID         *string  `json:"plugin_id,omitempty"`
	PluginName       *string  `json:"plugin_name,omitempty"`
}

type CapabilityLayers struct {
	System      []Capability `json:"system"`
	UserOnly    []Capability `json:"user_only"`
	ProjectOnly []Capability `json:"project_only"`
	Plugin      []Capability `json:"plugin,omitempty"`
	AllVisible  []Capability `json:"all_visible"`
	FetchedAt   time.Time    `json:"fetched_at,omitempty"`
}

type ProviderCapabilityDiscoverer interface {
	DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (CapabilityLayers, error)
}

type ProviderCapabilityEditor interface {
	SaveProviderCapability(ctx context.Context, capability Capability, projectPath string) error
	DeleteProviderCapability(ctx context.Context, capability Capability, projectPath string) error
}

func EmptyCapabilityLayers(providerID string) CapabilityLayers {
	return NormalizeCapabilityLayers(providerID, nil)
}

func NormalizeCapabilityLayers(providerID string, capabilities []Capability) CapabilityLayers {
	normalized := dedupeCapabilities(providerID, capabilities)
	sortCapabilities(normalized)

	layers := CapabilityLayers{
		FetchedAt: time.Now().UTC(),
	}
	for _, capability := range normalized {
		switch capability.Scope {
		case string(CapabilityScopeUser):
			layers.UserOnly = append(layers.UserOnly, capability)
		case string(CapabilityScopeProject):
			layers.ProjectOnly = append(layers.ProjectOnly, capability)
		case string(CapabilityScopePlugin):
			layers.Plugin = append(layers.Plugin, capability)
		default:
			layers.System = append(layers.System, capability)
		}
	}
	layers.AllVisible = append(layers.AllVisible, layers.ProjectOnly...)
	layers.AllVisible = append(layers.AllVisible, layers.UserOnly...)
	layers.AllVisible = append(layers.AllVisible, layers.Plugin...)
	layers.AllVisible = append(layers.AllVisible, layers.System...)
	return layers
}

func CapabilityKey(providerID, kind, name string) string {
	cleanProvider := strings.TrimSpace(providerID)
	cleanKind := strings.TrimSpace(kind)
	cleanName := strings.TrimPrefix(strings.TrimSpace(name), "/")
	return cleanProvider + ":" + cleanKind + ":" + cleanName
}

func cloneCapabilityLayers(in CapabilityLayers) CapabilityLayers {
	out := in
	out.System = append([]Capability(nil), in.System...)
	out.UserOnly = append([]Capability(nil), in.UserOnly...)
	out.ProjectOnly = append([]Capability(nil), in.ProjectOnly...)
	out.Plugin = append([]Capability(nil), in.Plugin...)
	out.AllVisible = append([]Capability(nil), in.AllVisible...)
	return out
}

func dedupeCapabilities(providerID string, capabilities []Capability) []Capability {
	seen := make(map[string]struct{}, len(capabilities))
	result := make([]Capability, 0, len(capabilities))

	for _, capability := range capabilities {
		if capability.Provider == "" {
			capability.Provider = providerID
		}
		capability.Name = strings.TrimPrefix(strings.TrimSpace(capability.Name), "/")
		capability.SlashName = strings.TrimSpace(capability.SlashName)
		if capability.Name == "" {
			capability.Name = strings.TrimPrefix(strings.TrimSpace(capability.SlashName), "/")
		}
		if capability.SlashName == "" && capability.Name != "" {
			capability.SlashName = "/" + capability.Name
		}
		if capability.Kind == "" {
			capability.Kind = string(CapabilityKindCommand)
		}
		if capability.Scope == "" {
			capability.Scope = string(CapabilityScopeSystem)
		}
		if capability.Key == "" {
			keyName := capability.Name
			if capability.SlashName != "" {
				keyName = capability.SlashName
			}
			capability.Key = CapabilityKey(capability.Provider, capability.Kind, keyName)
		}
		if capability.Name == "" || capability.Provider == "" || capability.Kind == "" {
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

func sortCapabilities(capabilities []Capability) {
	sort.Slice(capabilities, func(i, j int) bool {
		left := capabilities[i]
		right := capabilities[j]
		if scopeOrder(left.Scope) != scopeOrder(right.Scope) {
			return scopeOrder(left.Scope) < scopeOrder(right.Scope)
		}
		if kindOrder(left.Kind) != kindOrder(right.Kind) {
			return kindOrder(left.Kind) < kindOrder(right.Kind)
		}
		return left.SlashName < right.SlashName
	})
}

func scopeOrder(scope string) int {
	switch scope {
	case string(CapabilityScopeProject):
		return 0
	case string(CapabilityScopeUser):
		return 1
	case string(CapabilityScopePlugin):
		return 2
	case string(CapabilityScopeSystem):
		return 3
	default:
		return 4
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
