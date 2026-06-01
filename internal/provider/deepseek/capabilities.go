package deepseek

import (
	"context"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityDiscoverer = (*Driver)(nil)

func (d *Driver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	deepseekDir, err := DeepSeekDir()
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	var capabilities []provider.Capability
	capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeUser, []provider.FilesystemCapabilityDir{
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(deepseekDir, "commands")},
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(deepseekDir, "prompts")},
		{Kind: provider.CapabilityKindAgent, Path: filepath.Join(deepseekDir, "agents")},
		{Kind: provider.CapabilityKindSkill, Path: filepath.Join(deepseekDir, "skills")},
	})...)

	if projectPath != "" {
		capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeProject, []provider.FilesystemCapabilityDir{
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".deepseek", "commands")},
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".deepseek", "prompts")},
			{Kind: provider.CapabilityKindAgent, Path: filepath.Join(projectPath, ".deepseek", "agents")},
			{Kind: provider.CapabilityKindSkill, Path: filepath.Join(projectPath, ".deepseek", "skills")},
		})...)
	}

	return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
}
