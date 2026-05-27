package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type Skill struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	FullName     string   `json:"full_name"`
	Scope        string   `json:"scope"`
	Content      string   `json:"content"`
	Description  *string  `json:"description,omitempty"`
	FilePath     string   `json:"path"`
	PluginID     *string  `json:"plugin_id,omitempty"`
	PluginName   *string  `json:"plugin_name,omitempty"`
	AllowedTools []string `json:"allowed_tools"`
}

type frontmatter struct {
	Name         string
	Description  string
	AllowedTools string
}

func List(projectPath string) ([]Skill, error) {
	var skills []Skill

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return skills, nil
	}

	skills = append(skills, loadPluginSkills(homeDir)...)
	skills = append(skills, loadFromDirectory(filepath.Join(homeDir, ".claude", "skills"), "user", nil, nil)...)

	if projectPath != "" {
		skills = append(skills, loadFromDirectory(filepath.Join(projectPath, ".claude", "skills"), "project", nil, nil)...)
	}

	sort.Slice(skills, func(i, j int) bool {
		oi, oj := scopeOrder(skills[i].Scope), scopeOrder(skills[j].Scope)
		if oi != oj {
			return oi < oj
		}
		return skills[i].Name < skills[j].Name
	})

	return skills, nil
}

func Get(id, projectPath string) (*Skill, error) {
	skills, err := List(projectPath)
	if err != nil {
		return nil, err
	}
	for _, s := range skills {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("skill not found: %s", id)
}
