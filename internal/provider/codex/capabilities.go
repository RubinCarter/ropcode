package codex

import (
	"context"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityDiscoverer = (*Driver)(nil)

func (d *Driver) DiscoverProviderCapabilities(ctx context.Context, projectPath string, force bool) (provider.CapabilityLayers, error) {
	codexDir, err := CodexDir()
	if err != nil {
		return provider.CapabilityLayers{}, err
	}

	capabilities := codexBuiltinSlashCommands(d.ID())

	userCommands, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
		Provider: d.ID(),
		Kind:     provider.CapabilityKindCommand,
		Scope:    provider.CapabilityScopeUser,
		BaseDir:  filepath.Join(codexDir, "prompts"),
	})
	capabilities = append(capabilities, userCommands...)

	userAgents, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
		Provider: d.ID(),
		Kind:     provider.CapabilityKindAgent,
		Scope:    provider.CapabilityScopeUser,
		BaseDir:  filepath.Join(codexDir, "agents"),
	})
	capabilities = append(capabilities, userAgents...)

	userSkills, _ := provider.LoadSkillCapabilities(provider.SkillCapabilityOptions{
		Provider: d.ID(),
		Scope:    provider.CapabilityScopeUser,
		BaseDir:  filepath.Join(codexDir, "skills"),
	})
	capabilities = append(capabilities, userSkills...)

	appServerCapabilities, err := d.discoverAppServerCapabilities(ctx, projectPath, force)
	if err != nil {
		return provider.CapabilityLayers{}, err
	}
	capabilities = append(capabilities, appServerCapabilities...)

	if projectPath != "" {
		projectCommands, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
			Provider: d.ID(),
			Kind:     provider.CapabilityKindCommand,
			Scope:    provider.CapabilityScopeProject,
			BaseDir:  filepath.Join(projectPath, ".codex", "prompts"),
		})
		capabilities = append(capabilities, projectCommands...)

		projectAgents, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
			Provider: d.ID(),
			Kind:     provider.CapabilityKindAgent,
			Scope:    provider.CapabilityScopeProject,
			BaseDir:  filepath.Join(projectPath, ".codex", "agents"),
		})
		capabilities = append(capabilities, projectAgents...)

		projectSkills, _ := provider.LoadSkillCapabilities(provider.SkillCapabilityOptions{
			Provider: d.ID(),
			Scope:    provider.CapabilityScopeProject,
			BaseDir:  filepath.Join(projectPath, ".codex", "skills"),
		})
		capabilities = append(capabilities, projectSkills...)
	}

	return provider.NormalizeCapabilityLayers(d.ID(), capabilities), nil
}
