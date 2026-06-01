package claude

import (
	"os"
	"path/filepath"

	"ropcode/internal/provider"
)

func (d *Driver) filesystemCapabilities(projectPath string) []provider.Capability {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var capabilities []provider.Capability
	userCommands, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
		Provider: d.ID(),
		Kind:     provider.CapabilityKindCommand,
		Scope:    provider.CapabilityScopeUser,
		BaseDir:  filepath.Join(home, ".claude", "commands"),
	})
	capabilities = append(capabilities, userCommands...)

	userAgents, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
		Provider: d.ID(),
		Kind:     provider.CapabilityKindAgent,
		Scope:    provider.CapabilityScopeUser,
		BaseDir:  filepath.Join(home, ".claude", "agents"),
	})
	capabilities = append(capabilities, userAgents...)

	capabilities = append(capabilities, provider.LoadClaudePluginCommandCapabilities(home, d.ID())...)

	if projectPath != "" {
		projectCommands, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
			Provider: d.ID(),
			Kind:     provider.CapabilityKindCommand,
			Scope:    provider.CapabilityScopeProject,
			BaseDir:  filepath.Join(projectPath, ".claude", "commands"),
		})
		capabilities = append(capabilities, projectCommands...)

		projectAgents, _ := provider.LoadMarkdownCapabilities(provider.MarkdownCapabilityOptions{
			Provider: d.ID(),
			Kind:     provider.CapabilityKindAgent,
			Scope:    provider.CapabilityScopeProject,
			BaseDir:  filepath.Join(projectPath, ".claude", "agents"),
		})
		capabilities = append(capabilities, projectAgents...)
	}

	return capabilities
}
