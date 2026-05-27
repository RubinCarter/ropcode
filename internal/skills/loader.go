package skills

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func loadPluginSkills(homeDir string) []Skill {
	var skills []Skill

	installedFile := filepath.Join(homeDir, ".claude", "plugins", "installed_plugins.json")
	if _, err := os.Stat(installedFile); os.IsNotExist(err) {
		return skills
	}

	content, err := os.ReadFile(installedFile)
	if err != nil {
		return skills
	}

	var installed struct {
		Plugins map[string][]struct {
			InstallPath string `json:"installPath"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(content, &installed); err != nil {
		return skills
	}

	for pluginID, entries := range installed.Plugins {
		if len(entries) == 0 {
			continue
		}

		pluginPath := entries[0].InstallPath
		pluginName := pluginID
		if atIdx := strings.Index(pluginID, "@"); atIdx > 0 {
			pluginName = pluginID[:atIdx]
		}

		skillsDir := filepath.Join(pluginPath, "skills")
		if _, err := os.Stat(skillsDir); err == nil {
			skills = append(skills, loadFromDirectory(skillsDir, "plugin", &pluginID, &pluginName)...)
			continue
		}

		skills = append(skills, loadFromManifest(pluginPath, pluginID, pluginName)...)
	}

	return skills
}

func loadFromManifest(pluginPath, pluginID, pluginName string) []Skill {
	var skills []Skill

	marketplacePath := filepath.Join(pluginPath, ".claude-plugin", "marketplace.json")
	if content, err := os.ReadFile(marketplacePath); err == nil {
		var marketplace struct {
			Plugins []struct {
				Name   string   `json:"name"`
				Skills []string `json:"skills"`
			} `json:"plugins"`
		}
		if err := json.Unmarshal(content, &marketplace); err == nil {
			for _, p := range marketplace.Plugins {
				if p.Name == pluginName && len(p.Skills) > 0 {
					for _, skillPath := range p.Skills {
						fullPath := filepath.Join(pluginPath, strings.TrimPrefix(skillPath, "./"))
						if skill := loadFromDir(fullPath, "plugin", &pluginID, &pluginName); skill != nil {
							skills = append(skills, *skill)
						}
					}
					return skills
				}
			}
		}
	}

	pluginJsonPath := filepath.Join(pluginPath, ".claude-plugin", "plugin.json")
	if content, err := os.ReadFile(pluginJsonPath); err == nil {
		var pluginJson struct {
			Skills []string `json:"skills"`
		}
		if err := json.Unmarshal(content, &pluginJson); err == nil && len(pluginJson.Skills) > 0 {
			for _, skillPath := range pluginJson.Skills {
				fullPath := filepath.Join(pluginPath, strings.TrimPrefix(skillPath, "./"))
				if skill := loadFromDir(fullPath, "plugin", &pluginID, &pluginName); skill != nil {
					skills = append(skills, *skill)
				}
			}
		}
	}

	return skills
}

func loadFromDirectory(dir, scope string, pluginID, pluginName *string) []Skill {
	var skills []Skill

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return skills
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return skills
	}

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		entryPath := filepath.Join(dir, entry.Name())
		if entry.IsDir() {
			if skill := loadFromDir(entryPath, scope, pluginID, pluginName); skill != nil {
				skills = append(skills, *skill)
			}
		} else if strings.HasSuffix(entry.Name(), ".md") {
			if skill := loadFromFile(entryPath, scope, pluginID, pluginName); skill != nil {
				skills = append(skills, *skill)
			}
		}
	}

	return skills
}

func loadFromDir(dirPath, scope string, pluginID, pluginName *string) *Skill {
	skillFile := filepath.Join(dirPath, "SKILL.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		return nil
	}

	content, err := os.ReadFile(skillFile)
	if err != nil {
		return nil
	}

	fm, body := parseFrontmatter(string(content))
	name := fm.Name
	if name == "" {
		name = filepath.Base(dirPath)
	}

	return buildSkill(name, scope, body, dirPath, fm, pluginID, pluginName)
}

func loadFromFile(filePath, scope string, pluginID, pluginName *string) *Skill {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	fm, body := parseFrontmatter(string(content))
	name := fm.Name
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(filePath), ".md")
	}

	return buildSkill(name, scope, body, filePath, fm, pluginID, pluginName)
}

func buildSkill(name, scope, body, path string, fm frontmatter, pluginID, pluginName *string) *Skill {
	var description *string
	if fm.Description != "" {
		description = &fm.Description
	}

	var allowedTools []string
	if fm.AllowedTools != "" {
		for _, tool := range strings.Split(fm.AllowedTools, ",") {
			allowedTools = append(allowedTools, strings.TrimSpace(tool))
		}
	}

	var fullName string
	if scope == "plugin" && pluginName != nil {
		fullName = ":" + *pluginName + ":" + name
	} else {
		fullName = ":" + name
	}

	var id string
	switch scope {
	case "plugin":
		if pluginID != nil {
			sanitized := strings.ReplaceAll(strings.ReplaceAll(*pluginID, "@", "-"), "/", "-")
			id = "plugin:" + sanitized + ":" + name
		} else {
			id = "plugin:" + name
		}
	case "user":
		id = "user:" + name
	case "project":
		id = "project:" + name
	}

	return &Skill{
		ID:           id,
		Name:         name,
		FullName:     fullName,
		Scope:        scope,
		Content:      body,
		Description:  description,
		FilePath:     path,
		PluginID:     pluginID,
		PluginName:   pluginName,
		AllowedTools: allowedTools,
	}
}

func parseFrontmatter(content string) (frontmatter, string) {
	var fm frontmatter

	if !strings.HasPrefix(content, "---\n") && !strings.HasPrefix(content, "---\r\n") {
		return fm, content
	}

	startOffset := 4
	if strings.HasPrefix(content, "---\r\n") {
		startOffset = 5
	}

	endIdx := strings.Index(content[startOffset:], "\n---\n")
	if endIdx == -1 {
		endIdx = strings.Index(content[startOffset:], "\r\n---\r\n")
		if endIdx == -1 {
			return fm, content
		}
	}

	fmStr := content[startOffset : startOffset+endIdx]
	bodyStart := startOffset + endIdx + 5
	if bodyStart < len(content) {
		lines := strings.Split(fmStr, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "name:") {
				fm.Name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
			} else if strings.HasPrefix(line, "description:") {
				fm.Description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
			} else if strings.HasPrefix(line, "allowed-tools:") {
				fm.AllowedTools = strings.TrimSpace(strings.TrimPrefix(line, "allowed-tools:"))
			}
		}
		return fm, strings.TrimSpace(content[bodyStart:])
	}

	return fm, content
}

func scopeOrder(s string) int {
	switch s {
	case "project":
		return 0
	case "user":
		return 1
	case "plugin":
		return 2
	default:
		return 3
	}
}
