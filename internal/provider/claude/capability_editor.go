package claude

import (
	"context"
	"fmt"
	"path/filepath"

	"ropcode/internal/provider"
)

var _ provider.ProviderCapabilityEditor = (*Driver)(nil)

func (d *Driver) SaveProviderCapability(ctx context.Context, capability provider.Capability, projectPath string) error {
	dir, err := d.editableCapabilityDir(capability, projectPath)
	if err != nil {
		return err
	}
	return provider.SaveMarkdownCapability(dir, capability)
}

func (d *Driver) DeleteProviderCapability(ctx context.Context, capability provider.Capability, projectPath string) error {
	dir, err := d.editableCapabilityDir(capability, projectPath)
	if err != nil {
		return err
	}
	return provider.DeleteMarkdownCapability(dir, capability)
}

func (d *Driver) editableCapabilityDir(capability provider.Capability, projectPath string) (string, error) {
	capability, err := provider.NormalizeEditableCapability(capability)
	if err != nil {
		return "", err
	}
	switch capability.Scope {
	case string(provider.CapabilityScopeUser):
		return filepath.Join(provider.UserHomeDir(), ".claude", "commands"), nil
	case string(provider.CapabilityScopeProject):
		if projectPath == "" {
			return "", fmt.Errorf("project path is required for project-level capabilities")
		}
		return filepath.Join(projectPath, ".claude", "commands"), nil
	default:
		return "", fmt.Errorf("scope %s is not editable", capability.Scope)
	}
}
