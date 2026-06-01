package main

import (
	"context"
	"sync"

	claudelegacy "ropcode/internal/claude"
	"ropcode/internal/provider"
)

type claudeProviderCapabilitySource struct {
	mu      sync.Mutex
	service claudelegacy.CapabilityDiscovery
}

func (s *claudeProviderCapabilitySource) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	service, err := s.discovery()
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	var layers claudelegacy.CapabilityLayers
	if force {
		layers, err = service.Refresh(projectPath)
	} else {
		layers, err = service.Discover(projectPath)
	}
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	return provider.NormalizeCapabilityLayers("claude", capabilitiesFromClaudeLayers("claude", layers)), nil
}

func (s *claudeProviderCapabilitySource) discovery() (claudelegacy.CapabilityDiscovery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.service != nil {
		return s.service, nil
	}
	transport, err := claudelegacy.NewClaudeCapabilityDiscoveryTransport()
	if err != nil {
		return nil, err
	}
	s.service = claudelegacy.NewCapabilityDiscoveryService(transport)
	return s.service, nil
}

func capabilitiesFromClaudeLayers(providerID string, layers claudelegacy.CapabilityLayers) []provider.Capability {
	capabilities := make([]provider.Capability, 0, len(layers.System)+len(layers.UserOnly)+len(layers.ProjectOnly))
	appendLayer := func(items []claudelegacy.ClaudeCapability) {
		for _, item := range items {
			capabilities = append(capabilities, provider.Capability{
				Key:          provider.CapabilityKey(providerID, item.Kind, item.SlashName),
				Provider:     providerID,
				Name:         item.Name,
				SlashName:    item.SlashName,
				Kind:         item.Kind,
				Description:  item.Description,
				ArgumentHint: item.ArgumentHint,
				Scope:        item.Scope,
			})
		}
	}
	appendLayer(layers.System)
	appendLayer(layers.UserOnly)
	appendLayer(layers.ProjectOnly)
	return capabilities
}
