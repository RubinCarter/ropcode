package pi

import (
	"context"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityDiscoverer = (*Driver)(nil)

func (d *Driver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	piDir, err := PiDir()
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	var capabilities []provider.Capability
	capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeUser, []provider.FilesystemCapabilityDir{
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(piDir, "commands")},
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(piDir, "prompts")},
		{Kind: provider.CapabilityKindAgent, Path: filepath.Join(piDir, "agents")},
		{Kind: provider.CapabilityKindSkill, Path: filepath.Join(piDir, "skills")},
	})...)

	if projectPath != "" {
		capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeProject, []provider.FilesystemCapabilityDir{
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".pi", "commands")},
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".pi", "prompts")},
			{Kind: provider.CapabilityKindAgent, Path: filepath.Join(projectPath, ".pi", "agents")},
			{Kind: provider.CapabilityKindSkill, Path: filepath.Join(projectPath, ".pi", "skills")},
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".pi", "agent", "commands")},
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".pi", "agent", "prompts")},
			{Kind: provider.CapabilityKindAgent, Path: filepath.Join(projectPath, ".pi", "agent", "agents")},
			{Kind: provider.CapabilityKindSkill, Path: filepath.Join(projectPath, ".pi", "agent", "skills")},
		})...)
	}

	return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
}
