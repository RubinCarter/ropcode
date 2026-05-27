package actions

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Action struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Command     string `json:"command"`
	Icon        string `json:"icon,omitempty"`
	Scope       string `json:"scope,omitempty"`
	Type        string `json:"type,omitempty"`
	ActionType  string `json:"actionType,omitempty"`
	Shared      bool   `json:"shared,omitempty"`
}

type Result struct {
	GlobalActions    []Action `json:"global_actions"`
	ProjectActions   []Action `json:"project_actions"`
	WorkspaceActions []Action `json:"workspace_actions"`
}

func GetAll(projectPath, workspacePath string) (*Result, error) {
	result := &Result{
		GlobalActions:    []Action{},
		ProjectActions:   []Action{},
		WorkspaceActions: []Action{},
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return result, nil
	}

	globalPath := filepath.Join(homeDir, ".claude", "actions.json")
	if globalActions, err := loadFromFile(globalPath, "global"); err == nil {
		result.GlobalActions = globalActions
	}

	if projectPath != "" {
		p := filepath.Join(projectPath, ".claude", "actions.json")
		if a, err := loadFromFile(p, "project"); err == nil {
			result.ProjectActions = a
		}
	}

	if workspacePath != "" {
		p := filepath.Join(workspacePath, ".claude", "actions.json")
		if a, err := loadFromFile(p, "workspace"); err == nil {
			result.WorkspaceActions = a
		}
	}

	return result, nil
}

func GetGlobal() ([]Action, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return []Action{}, nil
	}
	a, err := loadFromFile(filepath.Join(homeDir, ".claude", "actions.json"), "global")
	if err != nil {
		return []Action{}, nil
	}
	return a, nil
}

func UpdateGlobal(acts []Action) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	return saveToFile(filepath.Join(homeDir, ".claude", "actions.json"), acts)
}

func UpdateProject(projectPath string, acts []Action) error {
	if projectPath == "" {
		return fmt.Errorf("project path is required")
	}
	return saveToFile(filepath.Join(projectPath, ".claude", "actions.json"), acts)
}

func UpdateWorkspace(workspacePath string, acts []Action) error {
	if workspacePath == "" {
		return fmt.Errorf("workspace path is required")
	}
	return saveToFile(filepath.Join(workspacePath, ".claude", "actions.json"), acts)
}

func loadFromFile(path, scope string) ([]Action, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var acts []Action
	if err := json.Unmarshal(data, &acts); err != nil {
		return nil, err
	}
	for i := range acts {
		acts[i].Scope = scope
	}
	return acts, nil
}

func saveToFile(path string, acts []Action) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(acts, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
