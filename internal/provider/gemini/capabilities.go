package gemini

import (
	"context"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityDiscoverer = (*Driver)(nil)

func (d *Driver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	geminiDir, err := GeminiDir()
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	var capabilities []provider.Capability
	capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeUser, []provider.FilesystemCapabilityDir{
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(geminiDir, "commands")},
		{Kind: provider.CapabilityKindCommand, Path: filepath.Join(geminiDir, "prompts")},
		{Kind: provider.CapabilityKindAgent, Path: filepath.Join(geminiDir, "agents")},
		{Kind: provider.CapabilityKindAgent, Path: filepath.Join(geminiDir, "antigravity", "agents")},
		{Kind: provider.CapabilityKindSkill, Path: filepath.Join(geminiDir, "skills")},
		{Kind: provider.CapabilityKindSkill, Path: filepath.Join(geminiDir, "antigravity", "skills")},
		{Kind: provider.CapabilityKindSkill, Path: filepath.Join(geminiDir, "antigravity", "global_skills")},
	})...)

	if projectPath != "" {
		capabilities = append(capabilities, provider.LoadFilesystemCapabilityDirs(d.ID(), provider.CapabilityScopeProject, []provider.FilesystemCapabilityDir{
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".gemini", "commands")},
			{Kind: provider.CapabilityKindCommand, Path: filepath.Join(projectPath, ".gemini", "prompts")},
			{Kind: provider.CapabilityKindAgent, Path: filepath.Join(projectPath, ".gemini", "agents")},
			{Kind: provider.CapabilityKindSkill, Path: filepath.Join(projectPath, ".gemini", "skills")},
		})...)
	}

	return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
}
