package rpc

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/git"
	providerPi "ropcode/internal/provider/pi"

	"github.com/google/uuid"
)

func ProjectHandlers(d *Deps) map[string]Handler {
	emitProjectChanged := func(project *database.ProjectIndex, reason string, workspace *database.WorkspaceIndex) {
		if d.EventHub == nil || project == nil {
			return
		}
		event := eventhub.ProjectChangedEvent{
			ProjectName: project.Name,
			Reason:      reason,
			Timestamp:   time.Now().UTC(),
		}
		if len(project.Providers) > 0 {
			event.ProjectPath = project.Providers[0].Path
		}
		if workspace != nil {
			event.WorkspaceName = workspace.Name
			if len(workspace.Providers) > 0 {
				event.WorkspacePath = workspace.Providers[0].Path
			}
		}
		d.EventHub.EmitProjectChanged(event)
	}

	return map[string]Handler{
		"GetConfig": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				return nil, nil
			}
			return map[string]string{
				"home_dir":      d.Config.HomeDir,
				"ropcode_dir":   d.Config.RopcodeDir,
				"claude_dir":    d.Config.ClaudeDir,
				"database_path": d.Config.DatabasePath,
				"log_dir":       d.Config.LogDir,
			}, nil
		},
		"GetHomeDirectory": func(p json.RawMessage) (any, error) {
			if d.Config == nil {
				home, _ := os.UserHomeDir()
				return home, nil
			}
			return d.Config.HomeDir, nil
		},
		"OpenDirectoryDialog": func(p json.RawMessage) (any, error) {
			defaultPath := argString(p, 1)
			if defaultPath == "" {
				defaultPath, _ = os.UserHomeDir()
			}
			return defaultPath, nil
		},
		"OpenFileDialog": func(p json.RawMessage) (any, error) {
			defaultPath := argString(p, 1)
			if defaultPath == "" {
				defaultPath, _ = os.UserHomeDir()
			}
			return defaultPath, nil
		},
		"ListProjects": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			projects, err := d.DB.GetAllProjectIndexes()
			if err != nil {
				return nil, err
			}
			for _, project := range projects {
				if len(project.Providers) > 0 {
					project.ID = project.Providers[0].ID
					project.Path = project.Providers[0].Path
				}
				if project.CreatedAt == 0 {
					project.CreatedAt = project.AddedAt
				}
				for i := range project.Workspaces {
					if len(project.Workspaces[i].Providers) > 0 {
						project.Workspaces[i].ID = project.Workspaces[i].Providers[0].ID
					}
				}
				if project.HasGitSupport == nil {
					if len(project.Providers) > 0 {
						path := project.Providers[0].Path
						_, gitErr := git.Open(path)
						hasGit := gitErr == nil
						project.HasGitSupport = &hasGit
						d.DB.SaveProjectIndex(project)
					}
				}
			}
			return projects, nil
		},
		"GetProjectIndex": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return d.DB.GetProjectIndex(argString(p, 0))
		},
		"SaveProjectIndex": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			project := argObject[database.ProjectIndex](p, 0)
			if err := d.DB.SaveProjectIndex(&project); err != nil {
				return nil, err
			}
			emitProjectChanged(&project, "project-saved", nil)
			return nil, nil
		},
		"DeleteProjectIndex": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			name := argString(p, 0)
			project, _ := d.DB.GetProjectIndex(name)
			if err := d.DB.DeleteProjectIndex(name); err != nil {
				return nil, err
			}
			if project != nil {
				emitProjectChanged(project, "project-deleted", nil)
			}
			return nil, nil
		},
		"AddProjectToIndex": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, addProjectToIndex(d, argString(p, 0), emitProjectChanged)
		},
		"RemoveProjectFromIndex": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			id := argString(p, 0)
			project, _ := d.DB.GetProjectIndex(id)
			if err := d.DB.DeleteProjectIndex(id); err != nil {
				return nil, err
			}
			if project != nil {
				emitProjectChanged(project, "project-removed", nil)
			}
			return nil, nil
		},
		"UpdateProjectAccessTime": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			id := argString(p, 0)
			project, err := d.DB.GetProjectIndex(id)
			if err != nil {
				return nil, err
			}
			project.LastAccessed = time.Now().Unix()
			if err := d.DB.SaveProjectIndex(project); err != nil {
				return nil, err
			}
			emitProjectChanged(project, "project-accessed", nil)
			return nil, nil
		},
		"CreateProject": func(p json.RawMessage) (any, error) {
			path := argString(p, 0)
			if err := os.MkdirAll(path, 0755); err != nil {
				return nil, err
			}
			return nil, addProjectToIndex(d, path, emitProjectChanged)
		},
		"OpenNewSession": func(p json.RawMessage) (any, error) {
			return uuid.New().String(), nil
		},
		"CreateWorkspace": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			parent := argString(p, 0)
			branch := argString(p, 1)
			name := argString(p, 2)
			return nil, createWorkspace(d, parent, branch, name, emitProjectChanged)
		},
		"RemoveWorkspace": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, removeWorkspace(d, argString(p, 0), emitProjectChanged)
		},
		"UpdateProjectFields": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, updateProjectFields(d, argString(p, 0), argObject[map[string]interface{}](p, 1), emitProjectChanged)
		},
		"UpdateWorkspaceFields": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, updateWorkspaceFields(d, argString(p, 0), argObject[map[string]interface{}](p, 1), emitProjectChanged)
		},
		"UpdateProjectLastProvider": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			path := argString(p, 0)
			provider := argString(p, 1)
			name := filepath.Base(path)
			project, err := d.DB.GetProjectIndex(name)
			if err != nil {
				return nil, err
			}
			project.LastProvider = provider
			if err := d.DB.SaveProjectIndex(project); err != nil {
				return nil, err
			}
			emitProjectChanged(project, "project-last-provider-updated", nil)
			return nil, nil
		},
		"UpdateWorkspaceLastProvider": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			path := argString(p, 0)
			provider := argString(p, 1)
			projects, err := d.DB.GetAllProjectIndexes()
			if err != nil {
				return nil, err
			}
			workspaceName := filepath.Base(path)
			for _, project := range projects {
				for i, ws := range project.Workspaces {
					if ws.Name == workspaceName {
						project.Workspaces[i].LastProvider = provider
						updated := project.Workspaces[i]
						if err := d.DB.SaveProjectIndex(project); err != nil {
							return nil, err
						}
						emitProjectChanged(project, "workspace-last-provider-updated", &updated)
						return nil, nil
					}
				}
			}
			return nil, nil
		},
		// Provider API Config
		"SaveProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			config := argObject[database.ProviderApiConfig](p, 0)
			return nil, d.DB.SaveProviderApiConfig(&config)
		},
		"GetProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return getProviderAPIConfigByID(d, argString(p, 0))
		},
		"GetAllProviderApiConfigs": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return []*database.ProviderApiConfig{}, nil
			}
			configs, err := d.DB.GetAllProviderApiConfigs()
			if err != nil {
				return []*database.ProviderApiConfig{}, err
			}
			if configs == nil {
				return []*database.ProviderApiConfig{}, nil
			}
			return withPiLocalProviderAPIConfigs(configs), nil
		},
		"DeleteProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, d.DB.DeleteProviderApiConfig(argString(p, 0))
		},
		"CreateProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			config := argObject[database.ProviderApiConfig](p, 0)
			config.ID = uuid.New().String()
			if config.IsDefault {
				d.DB.ClearDefaultProviderApiConfig(config.ProviderID)
			}
			return nil, d.DB.SaveProviderApiConfig(&config)
		},
		"GetProjectProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return getProjectProviderApiConfig(d, argString(p, 0), argString(p, 1))
		},
		"SetProjectProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, setProjectProviderApiConfig(d, argString(p, 0), argString(p, 1), argString(p, 2), emitProjectChanged)
		},
		"AddProviderToProject": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, nil
			}
			return nil, addProviderToProject(d, argString(p, 0), argString(p, 1), emitProjectChanged)
		},
		"UpdateProviderApiConfig": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return updateProviderApiConfig(d, argString(p, 0), argObject[map[string]interface{}](p, 1))
		},
		"NotifyBranchRenamed": func(p json.RawMessage) (any, error) {
			return nil, nil
		},
	}
}

// --- Project helper functions ---

type projectChangedFn func(*database.ProjectIndex, string, *database.WorkspaceIndex)

func addProjectToIndex(d *Deps, path string, emit projectChangedFn) error {
	name := filepath.Base(path)
	now := time.Now().Unix()
	_, gitErr := git.Open(path)
	hasGitSupport := gitErr == nil

	existingProject, err := d.DB.GetProjectIndex(name)
	if err == nil && existingProject != nil {
		existingNames := make(map[string]bool)
		for _, ws := range existingProject.Workspaces {
			existingNames[ws.Name] = true
		}
		scanned, _ := scanRopcodeWorktrees(path)
		for _, ws := range scanned {
			if !existingNames[ws.Name] {
				existingProject.Workspaces = append(existingProject.Workspaces, ws)
			}
		}
		existingProject.LastAccessed = now
		existingProject.HasGitSupport = &hasGitSupport
		if err := d.DB.SaveProjectIndex(existingProject); err != nil {
			return err
		}
		emit(existingProject, "project-updated", nil)
		return nil
	}

	workspaces, _ := scanRopcodeWorktrees(path)
	if workspaces == nil {
		workspaces = []database.WorkspaceIndex{}
	}

	project := &database.ProjectIndex{
		Name:         name,
		AddedAt:      now,
		LastAccessed: now,
		Available:    true,
		Providers: []database.ProviderInfo{{
			ID: name, ProviderID: "claude", Path: path,
		}},
		Workspaces:    workspaces,
		LastProvider:  "claude",
		HasGitSupport: &hasGitSupport,
	}

	if err := d.DB.SaveProjectIndex(project); err != nil {
		return err
	}
	emit(project, "project-added", nil)
	return nil
}

func scanRopcodeWorktrees(projectPath string) ([]database.WorkspaceIndex, error) {
	ropcodeDir := filepath.Join(projectPath, ".ropcode")
	if _, err := os.Stat(ropcodeDir); os.IsNotExist(err) {
		return []database.WorkspaceIndex{}, nil
	}
	entries, err := os.ReadDir(ropcodeDir)
	if err != nil {
		return nil, err
	}
	var workspaces []database.WorkspaceIndex
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		worktreePath := filepath.Join(ropcodeDir, entry.Name())
		gitPath := filepath.Join(worktreePath, ".git")
		gitInfo, err := os.Stat(gitPath)
		if err != nil || gitInfo.IsDir() {
			continue
		}
		branch := entry.Name()
		cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
		cmd.Dir = worktreePath
		if output, err := cmd.Output(); err == nil {
			branch = strings.TrimSpace(string(output))
		}
		workspaces = append(workspaces, database.WorkspaceIndex{
			Name:    entry.Name(),
			AddedAt: time.Now().Unix(),
			Providers: []database.ProviderInfo{{
				ID: entry.Name(), ProviderID: "claude", Path: worktreePath,
			}},
			LastProvider: "claude",
			Branch:       branch,
		})
	}
	return workspaces, nil
}

func createWorkspace(d *Deps, parent, branch, name string, emit projectChangedFn) error {
	if _, err := os.Stat(parent); os.IsNotExist(err) {
		return fmt.Errorf("parent project path does not exist: %s", parent)
	}
	parentName := filepath.Base(parent)
	project, err := d.DB.GetProjectIndex(parentName)
	if err != nil {
		return err
	}
	if name == "" {
		name = branch
	}
	ropcodeDir := filepath.Join(parent, ".ropcode")
	if err := os.MkdirAll(ropcodeDir, 0755); err != nil {
		return err
	}
	workspacePath := filepath.Join(ropcodeDir, name)
	hasGitSupport := project.HasGitSupport != nil && *project.HasGitSupport
	if hasGitSupport {
		cmd := exec.Command("git", "worktree", "add", "-B", branch, workspacePath)
		cmd.Dir = parent
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to add worktree: %s - %w", string(output), err)
		}
	} else if err := os.MkdirAll(workspacePath, 0755); err != nil {
		return err
	}
	workspace := database.WorkspaceIndex{
		Name:    name,
		AddedAt: time.Now().Unix(),
		Providers: []database.ProviderInfo{{
			ID: name, ProviderID: "claude", Path: workspacePath,
		}},
		LastProvider: "claude",
		Branch:       branch,
	}
	project.Workspaces = append(project.Workspaces, workspace)
	if err := d.DB.SaveProjectIndex(project); err != nil {
		return err
	}
	emit(project, "workspace-created", &workspace)
	return nil
}

func removeWorkspace(d *Deps, id string, emit projectChangedFn) error {
	projects, err := d.DB.GetAllProjectIndexes()
	if err != nil {
		return err
	}
	for _, project := range projects {
		for i, ws := range project.Workspaces {
			if ws.Name == id {
				removed := ws
				project.Workspaces = append(project.Workspaces[:i], project.Workspaces[i+1:]...)
				if err := d.DB.SaveProjectIndex(project); err != nil {
					return err
				}
				emit(project, "workspace-removed", &removed)
				return nil
			}
		}
	}
	return nil
}

func updateProjectFields(d *Deps, path string, updates map[string]interface{}, emit projectChangedFn) error {
	name := filepath.Base(path)
	project, err := d.DB.GetProjectIndex(name)
	if err != nil {
		return err
	}
	if desc, ok := updates["description"].(string); ok {
		project.Description = desc
	}
	if available, ok := updates["available"].(bool); ok {
		project.Available = available
	}
	if lp, ok := updates["last_provider"].(string); ok {
		project.LastProvider = lp
	}
	if pt, ok := updates["project_type"].(string); ok {
		project.ProjectType = pt
	}
	if err := d.DB.SaveProjectIndex(project); err != nil {
		return err
	}
	emit(project, "project-updated", nil)
	return nil
}

func updateWorkspaceFields(d *Deps, path string, updates map[string]interface{}, emit projectChangedFn) error {
	projects, err := d.DB.GetAllProjectIndexes()
	if err != nil {
		return err
	}
	workspaceName := filepath.Base(path)
	for _, project := range projects {
		for i, ws := range project.Workspaces {
			if ws.Name == workspaceName {
				if branch, ok := updates["branch"].(string); ok {
					project.Workspaces[i].Branch = branch
				}
				if lp, ok := updates["last_provider"].(string); ok {
					project.Workspaces[i].LastProvider = lp
				}
				updated := project.Workspaces[i]
				if err := d.DB.SaveProjectIndex(project); err != nil {
					return err
				}
				emit(project, "workspace-updated", &updated)
				return nil
			}
		}
	}
	return fmt.Errorf("workspace not found: %s", workspaceName)
}

func getProjectProviderApiConfig(d *Deps, projectPath, providerName string) (*database.ProviderApiConfig, error) {
	name := filepath.Base(projectPath)
	project, err := d.DB.GetProjectIndex(name)
	if err != nil {
		return getDefaultProviderAPIConfig(d, providerName)
	}
	for _, provider := range project.Providers {
		if provider.ProviderID == providerName && provider.ProviderApiID != "" {
			return getProviderAPIConfigByID(d, provider.ProviderApiID)
		}
	}
	return getDefaultProviderAPIConfig(d, providerName)
}

func getProviderAPIConfigByID(d *Deps, id string) (*database.ProviderApiConfig, error) {
	if d.DB != nil {
		if cfg, err := d.DB.GetProviderApiConfig(id); err == nil && cfg != nil {
			return cfg, nil
		}
	}
	if strings.HasPrefix(id, providerPi.LocalProviderAPIConfigID("")) {
		if cfg, err := providerPi.LocalProviderAPIConfig(id); err == nil && cfg != nil {
			return cfg, nil
		}
	}
	return nil, fmt.Errorf("provider api config not found: %s", id)
}

func getDefaultProviderAPIConfig(d *Deps, providerName string) (*database.ProviderApiConfig, error) {
	if d.DB != nil {
		if cfg, err := d.DB.GetDefaultProviderApiConfig(providerName); err == nil && cfg != nil {
			return cfg, nil
		}
	}
	if providerName == "pi" {
		if cfg, err := providerPi.LocalDefaultProviderAPIConfig(); err == nil && cfg != nil {
			return cfg, nil
		}
	}
	return nil, nil
}

func withPiLocalProviderAPIConfigs(configs []*database.ProviderApiConfig) []*database.ProviderApiConfig {
	localConfigs, err := providerPi.LocalProviderAPIConfigs()
	if err != nil || len(localConfigs) == 0 {
		return configs
	}
	seen := make(map[string]bool, len(configs)+len(localConfigs))
	out := make([]*database.ProviderApiConfig, 0, len(configs)+len(localConfigs))
	for _, cfg := range configs {
		if cfg == nil {
			continue
		}
		seen[cfg.ID] = true
		out = append(out, cfg)
	}
	for _, cfg := range localConfigs {
		if cfg != nil && !seen[cfg.ID] {
			out = append(out, cfg)
		}
	}
	return out
}

func setProjectProviderApiConfig(d *Deps, projectPath, providerName, configId string, emit projectChangedFn) error {
	name := filepath.Base(projectPath)
	project, err := d.DB.GetProjectIndex(name)
	if err != nil {
		return err
	}
	found := false
	for i, prov := range project.Providers {
		if prov.ProviderID == providerName {
			project.Providers[i].ProviderApiID = configId
			found = true
			break
		}
	}
	if !found {
		project.Providers = append(project.Providers, database.ProviderInfo{
			ID: name, ProviderID: providerName, Path: projectPath, ProviderApiID: configId,
		})
	}
	if err := d.DB.SaveProjectIndex(project); err != nil {
		return err
	}
	emit(project, "project-provider-config-updated", nil)
	return nil
}

func addProviderToProject(d *Deps, path, provider string, emit projectChangedFn) error {
	name := filepath.Base(path)
	project, err := d.DB.GetProjectIndex(name)
	if err != nil {
		return err
	}
	for _, p := range project.Providers {
		if p.ProviderID == provider {
			return nil
		}
	}
	project.Providers = append(project.Providers, database.ProviderInfo{
		ID: name, ProviderID: provider, Path: path,
	})
	if err := d.DB.SaveProjectIndex(project); err != nil {
		return err
	}
	emit(project, "project-provider-added", nil)
	return nil
}

func updateProviderApiConfig(d *Deps, id string, updates map[string]interface{}) (*database.ProviderApiConfig, error) {
	config, err := d.DB.GetProviderApiConfig(id)
	if err != nil {
		return nil, err
	}
	if authToken, ok := updates["auth_token"].(string); ok {
		config.AuthToken = authToken
	}
	if baseUrl, ok := updates["base_url"].(string); ok {
		config.BaseURL = baseUrl
	}
	if name, ok := updates["name"].(string); ok {
		config.Name = name
	}
	if isDefault, ok := updates["is_default"].(bool); ok {
		if isDefault {
			d.DB.ClearDefaultProviderApiConfig(config.ProviderID)
		}
		config.IsDefault = isDefault
	}
	if err := d.DB.SaveProviderApiConfig(config); err != nil {
		return nil, err
	}
	return config, nil
}
