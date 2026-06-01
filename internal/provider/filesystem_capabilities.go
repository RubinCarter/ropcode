package provider

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const userHomeToken = "$HOME"

type MarkdownCapabilityOptions struct {
	Provider        string
	Kind            CapabilityKind
	Scope           CapabilityScope
	BaseDir         string
	CommandPrefix   string
	PluginID        *string
	PluginName      *string
	FullNameBuilder func(namespace *string, name string) string
}

type SkillCapabilityOptions struct {
	Provider   string
	Scope      CapabilityScope
	BaseDir    string
	PluginID   *string
	PluginName *string
}

type FilesystemCapabilityDir struct {
	Kind CapabilityKind
	Path string
}

type markdownFrontmatter struct {
	Name         string   `yaml:"name"`
	Description  string   `yaml:"description"`
	AllowedTools []string `yaml:"allowed-tools"`
	ArgumentHint string   `yaml:"argument-hint"`
	Tools        string   `yaml:"tools"`
	Color        string   `yaml:"color"`
	Model        string   `yaml:"model"`
}

type InstalledPluginsFile struct {
	Plugins map[string][]PluginEntry `json:"plugins"`
}

type PluginEntry struct {
	InstallPath string `json:"installPath"`
}

func LoadMarkdownCapabilities(opts MarkdownCapabilityOptions) ([]Capability, error) {
	if strings.TrimSpace(opts.BaseDir) == "" {
		return nil, nil
	}
	if _, err := os.Stat(opts.BaseDir); os.IsNotExist(err) {
		return nil, nil
	}
	files, err := findMarkdownFiles(opts.BaseDir)
	if err != nil {
		return nil, err
	}

	capabilities := make([]Capability, 0, len(files))
	for _, filePath := range files {
		capability, err := loadMarkdownCapability(filePath, opts)
		if err != nil {
			continue
		}
		capabilities = append(capabilities, capability)
	}
	return capabilities, nil
}

func LoadFilesystemCapabilityDirs(providerID string, scope CapabilityScope, dirs []FilesystemCapabilityDir) []Capability {
	var capabilities []Capability
	for _, dir := range dirs {
		switch dir.Kind {
		case CapabilityKindSkill:
			loaded, _ := LoadSkillCapabilities(SkillCapabilityOptions{
				Provider: providerID,
				Scope:    scope,
				BaseDir:  dir.Path,
			})
			capabilities = append(capabilities, loaded...)
		default:
			loaded, _ := LoadMarkdownCapabilities(MarkdownCapabilityOptions{
				Provider: providerID,
				Kind:     dir.Kind,
				Scope:    scope,
				BaseDir:  dir.Path,
			})
			capabilities = append(capabilities, loaded...)
		}
	}
	return capabilities
}

func LoadSkillCapabilities(opts SkillCapabilityOptions) ([]Capability, error) {
	if strings.TrimSpace(opts.BaseDir) == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(opts.BaseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	capabilities := make([]Capability, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		nameHint := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		filePath := filepath.Join(opts.BaseDir, entry.Name())
		if entry.IsDir() {
			filePath = filepath.Join(filePath, "SKILL.md")
			nameHint = entry.Name()
		} else if !strings.HasSuffix(strings.ToLower(entry.Name()), ".md") {
			continue
		}

		capability, err := loadSkillCapability(filePath, nameHint, opts)
		if err != nil {
			continue
		}
		capabilities = append(capabilities, capability)
	}
	return capabilities, nil
}

func LoadClaudePluginCommandCapabilities(homeDir, providerID string) []Capability {
	var capabilities []Capability
	pluginsDir := filepath.Join(homeDir, ".claude", "plugins")
	installedFile := filepath.Join(pluginsDir, "installed_plugins.json")
	content, err := os.ReadFile(installedFile)
	if err != nil {
		return capabilities
	}

	var installed InstalledPluginsFile
	if err := json.Unmarshal(content, &installed); err != nil {
		return capabilities
	}

	for pluginID, entries := range installed.Plugins {
		if len(entries) == 0 {
			continue
		}
		pluginPath := entries[0].InstallPath
		pluginName := pluginID
		if at := strings.Index(pluginID, "@"); at >= 0 {
			pluginName = pluginID[:at]
		}
		for _, dir := range []string{
			filepath.Join(pluginPath, "commands"),
			filepath.Join(pluginPath, ".claude", "commands"),
		} {
			id := pluginID
			name := pluginName
			loaded, err := LoadMarkdownCapabilities(MarkdownCapabilityOptions{
				Provider:   providerID,
				Kind:       CapabilityKindCommand,
				Scope:      CapabilityScopePlugin,
				BaseDir:    dir,
				PluginID:   &id,
				PluginName: &name,
				FullNameBuilder: func(namespace *string, commandName string) string {
					if namespace != nil && *namespace != "" {
						return fmt.Sprintf("/%s:%s:%s", name, *namespace, commandName)
					}
					return fmt.Sprintf("/%s:%s", name, commandName)
				},
			})
			if err == nil {
				capabilities = append(capabilities, loaded...)
			}
		}
	}
	return capabilities
}

func loadSkillCapability(filePath, nameHint string, opts SkillCapabilityOptions) (Capability, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return Capability{}, err
	}

	frontmatter, body := parseMarkdownFrontmatter(string(content))
	name := strings.TrimSpace(frontmatter.Name)
	if name == "" {
		name = strings.TrimSpace(nameHint)
	}
	if name == "" {
		return Capability{}, fmt.Errorf("skill capability name cannot be empty")
	}

	description := strings.TrimSpace(frontmatter.Description)
	if description == "" {
		description = strings.TrimSpace(firstParagraph(body))
	}

	capability := Capability{
		Provider:         opts.Provider,
		Name:             strings.TrimPrefix(name, "/"),
		SlashName:        "/" + strings.TrimPrefix(name, "/"),
		Kind:             string(CapabilityKindSkill),
		Description:      description,
		ArgumentHint:     frontmatter.ArgumentHint,
		Scope:            string(opts.Scope),
		SourcePath:       filePath,
		Content:          body,
		AllowedTools:     frontmatter.AllowedTools,
		HasBashCommands:  strings.Contains(body, "!`"),
		HasFileRefs:      strings.Contains(body, "@"),
		AcceptsArguments: strings.Contains(body, "$ARGUMENTS"),
		PluginID:         opts.PluginID,
		PluginName:       opts.PluginName,
	}
	capability.Key = CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
	return capability, nil
}

func loadMarkdownCapability(filePath string, opts MarkdownCapabilityOptions) (Capability, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return Capability{}, err
	}

	frontmatter, body := parseMarkdownFrontmatter(string(content))
	name, namespace := extractCapabilityName(filePath, opts.BaseDir)
	fullName := defaultCapabilityFullName(namespace, name)
	if opts.FullNameBuilder != nil {
		fullName = opts.FullNameBuilder(namespace, name)
	}
	if opts.CommandPrefix != "" {
		fullName = opts.CommandPrefix + strings.TrimPrefix(fullName, "/")
	}

	capability := Capability{
		Provider:         opts.Provider,
		Name:             name,
		SlashName:        fullName,
		Kind:             string(opts.Kind),
		Description:      frontmatter.Description,
		ArgumentHint:     frontmatter.ArgumentHint,
		Scope:            string(opts.Scope),
		Namespace:        namespace,
		SourcePath:       filePath,
		Content:          body,
		AllowedTools:     frontmatter.AllowedTools,
		HasBashCommands:  strings.Contains(body, "!`"),
		HasFileRefs:      strings.Contains(body, "@"),
		AcceptsArguments: strings.Contains(body, "$ARGUMENTS"),
		PluginID:         opts.PluginID,
		PluginName:       opts.PluginName,
	}
	capability.Key = CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
	if capability.Description == "" && opts.Kind == CapabilityKindAgent {
		capability.Description = strings.TrimSpace(firstParagraph(body))
	}
	return capability, nil
}

func findMarkdownFiles(dir string) ([]string, error) {
	var files []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(info.Name(), ".") {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

func parseMarkdownFrontmatter(content string) (markdownFrontmatter, string) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return markdownFrontmatter{}, content
	}
	end := 0
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end == 0 {
		return markdownFrontmatter{}, content
	}
	var fm markdownFrontmatter
	if err := yaml.Unmarshal([]byte(strings.Join(lines[1:end], "\n")), &fm); err != nil {
		return markdownFrontmatter{}, content
	}
	return fm, strings.Join(lines[end+1:], "\n")
}

func extractCapabilityName(filePath, baseDir string) (string, *string) {
	relPath, err := filepath.Rel(baseDir, filePath)
	if err != nil {
		return strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath)), nil
	}
	relPath = strings.TrimSuffix(relPath, filepath.Ext(relPath))
	parts := strings.Split(relPath, string(filepath.Separator))
	if len(parts) == 1 {
		return parts[0], nil
	}
	name := parts[len(parts)-1]
	namespace := strings.Join(parts[:len(parts)-1], ":")
	return name, &namespace
}

func defaultCapabilityFullName(namespace *string, name string) string {
	if namespace != nil && *namespace != "" {
		return fmt.Sprintf("/%s:%s", *namespace, name)
	}
	return "/" + name
}

func firstParagraph(body string) string {
	for _, block := range strings.Split(body, "\n\n") {
		if trimmed := strings.TrimSpace(block); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func NormalizeEditableCapability(capability Capability) (Capability, error) {
	capability.Name = strings.TrimPrefix(strings.TrimSpace(capability.Name), "/")
	capability.Content = strings.TrimSpace(capability.Content)
	if capability.Name == "" {
		return Capability{}, fmt.Errorf("capability name cannot be empty")
	}
	switch capability.Kind {
	case "", string(CapabilityKindCommand):
		capability.Kind = string(CapabilityKindCommand)
	default:
		return Capability{}, fmt.Errorf("unsupported editable capability kind: %s", capability.Kind)
	}
	switch capability.Scope {
	case string(CapabilityScopeUser), string(CapabilityScopeProject), "global":
		if capability.Scope == "global" {
			capability.Scope = string(CapabilityScopeUser)
		}
	default:
		return Capability{}, fmt.Errorf("invalid editable capability scope: %s", capability.Scope)
	}
	return capability, nil
}

func SaveMarkdownCapability(baseDir string, capability Capability) error {
	capability, err := NormalizeEditableCapability(capability)
	if err != nil {
		return err
	}
	if strings.TrimSpace(baseDir) == "" {
		return fmt.Errorf("capability directory cannot be empty")
	}
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return fmt.Errorf("failed to create capability directory: %w", err)
	}
	filePath := filepath.Join(baseDir, capability.Name+".md")
	if err := os.WriteFile(filePath, []byte(capability.Content), 0644); err != nil {
		return fmt.Errorf("failed to write capability file: %w", err)
	}
	return nil
}

func DeleteMarkdownCapability(baseDir string, capability Capability) error {
	capability, err := NormalizeEditableCapability(capability)
	if err != nil {
		return err
	}
	if strings.TrimSpace(baseDir) == "" {
		return fmt.Errorf("capability directory cannot be empty")
	}
	filePath := filepath.Join(baseDir, capability.Name+".md")
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("capability not found: %s", capability.Name)
	}
	if err := os.Remove(filePath); err != nil {
		return fmt.Errorf("failed to delete capability file: %w", err)
	}
	return nil
}

func UserHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return userHomeToken
	}
	return home
}
