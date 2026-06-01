package claude

import (
	"context"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityDiscoverer = (*Driver)(nil)

type CapabilitySource interface {
	DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error)
}

func (d *Driver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	capabilities := d.filesystemCapabilities(projectPath)
	if d.CapabilitySource == nil {
		return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
	}
	discovered, err := d.CapabilitySource.DiscoverProviderCapabilities(ctx, projectPath, force)
	if err != nil {
		return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
	}
	capabilities = append(capabilities, discovered.AllVisible...)
	return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
}
