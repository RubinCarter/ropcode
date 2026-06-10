package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/git"
	"ropcode/internal/provider"
)

func shouldIgnoreMissingRunningSessionOnClear(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no running sessions found for project:")
}

func (a *App) providerSessionConfig(providerName, projectPath, model, providerApiID, reasoningEffort string) provider.SessionConfig {
	config := provider.SessionConfig{
		ProjectPath:   projectPath,
		Model:         model,
		ProviderApiID: providerApiID,
	}
	if reasoningEffort != "" {
		config.Extra = map[string]string{"reasoning_effort": reasoningEffort}
	}
	if providerApiID != "" && a.dbManager != nil {
		apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
		if err == nil && apiConfig != nil {
			config.ProviderApiID = apiConfig.ID
			config.AuthToken = apiConfig.AuthToken
			config.BaseURL = apiConfig.BaseURL
		}
	} else if a.dbManager != nil {
		if apiConfig, _ := a.resolveProviderAPIConfig(providerName, providerApiID); apiConfig != nil {
			config.ProviderApiID = apiConfig.ID
			config.AuthToken = apiConfig.AuthToken
			config.BaseURL = apiConfig.BaseURL
		}
	}
	return config
}

// StopProviderSession stops a live provider session.
func (a *App) StopProviderSession(sessionID string) error {
	if a.providerManager == nil {
		return fmt.Errorf("provider manager not initialized")
	}
	return a.providerManager.TerminateSession(sessionID)
}

// ListRunningProviderSessions returns all currently running live sessions.
func (a *App) ListRunningProviderSessions() []LiveProviderSession {
	result := make([]LiveProviderSession, 0)
	if a.providerManager != nil {
		for _, session := range a.providerManager.ListAllSessions() {
			result = append(result, LiveProviderSession{
				SessionID:         session.SessionID,
				ProviderSessionID: session.ProviderSessionID,
				ProjectPath:       session.ProjectPath,
				Model:             session.Model,
				Status:            session.Status,
				StartedAt:         session.StartedAt,
				PID:               session.PID,
				Provider:          session.ProviderID,
			})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].StartedAt.After(result[j].StartedAt)
	})
	return result
}

// LiveProviderSession represents a running provider session.
type LiveProviderSession struct {
	SessionID         string    `json:"session_id"`
	ProviderSessionID string    `json:"provider_session_id,omitempty"`
	ProjectPath       string    `json:"project_path"`
	Model             string    `json:"model"`
	Status            string    `json:"status"`
	StartedAt         time.Time `json:"started_at"`
	PID               int       `json:"pid,omitempty"`
	Provider          string    `json:"provider"`
}

// ProjectChangedEvent alias for tests.
type ProjectChangedEvent = eventhub.ProjectChangedEvent

// GetProviderSessionOutput returns buffered output for a live provider session.
func (a *App) GetProviderSessionOutput(sessionID string) (string, error) {
	if a.providerManager == nil {
		return "", fmt.Errorf("provider manager not initialized")
	}
	return a.providerManager.GetSessionOutput(sessionID)
}

// CreateProject creates a new project directory and adds to index.
func (a *App) CreateProject(path string) error {
	if err := os.MkdirAll(path, 0755); err != nil {
		return err
	}
	return a.AddProjectToIndex(path)
}

// CreateWorkspace creates a new workspace (git worktree).
func (a *App) CreateWorkspace(parent, branch, name string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := os.Stat(parent); os.IsNotExist(err) {
		return fmt.Errorf("parent project path does not exist: %s", parent)
	}
	parentName := filepath.Base(parent)
	project, err := a.dbManager.GetProjectIndex(parentName)
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
	if err := a.dbManager.SaveProjectIndex(project); err != nil {
		return err
	}
	a.emitProjectChanged(project, "workspace-created", &workspace)
	return nil
}

// AddProjectToIndex adds a project to the database index.
func (a *App) AddProjectToIndex(path string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database not initialized")
	}
	name := filepath.Base(path)
	now := time.Now().Unix()
	_, gitErr := git.Open(path)
	hasGitSupport := gitErr == nil

	existingProject, err := a.dbManager.GetProjectIndex(name)
	if err == nil && existingProject != nil {
		existingProject.LastAccessed = now
		existingProject.HasGitSupport = &hasGitSupport
		if err := a.dbManager.SaveProjectIndex(existingProject); err != nil {
			return err
		}
		a.emitProjectChanged(existingProject, "project-updated", nil)
		return nil
	}

	project := &database.ProjectIndex{
		Name:         name,
		AddedAt:      now,
		LastAccessed: now,
		Available:    true,
		Providers: []database.ProviderInfo{{
			ID: name, ProviderID: "claude", Path: path,
		}},
		Workspaces:    []database.WorkspaceIndex{},
		LastProvider:  "claude",
		HasGitSupport: &hasGitSupport,
	}
	if err := a.dbManager.SaveProjectIndex(project); err != nil {
		return err
	}
	a.emitProjectChanged(project, "project-added", nil)
	return nil
}

func (a *App) emitProjectChanged(project *database.ProjectIndex, reason string, workspace *database.WorkspaceIndex) {
	if a.eventHub == nil || project == nil {
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
	a.eventHub.EmitProjectChanged(event)
}

func emitAgentRunChanged(hub *eventhub.EventHub, run *database.AgentRun, status string, pid int, completedAt *time.Time, errorMessage string) {
	if hub == nil || run == nil {
		return
	}
	if status == "" {
		status = run.Status
	}
	if pid == 0 {
		pid = run.PID
	}
	if completedAt == nil {
		completedAt = run.CompletedAt
	}

	hub.EmitAgentRunChanged(eventhub.AgentRunChangedEvent{
		RunID:       run.ID,
		AgentID:     run.AgentID,
		AgentName:   run.AgentName,
		AgentIcon:   run.AgentIcon,
		Task:        run.Task,
		Model:       run.Model,
		ProjectPath: run.ProjectPath,
		SessionID:   run.SessionID,
		Status:      status,
		PID:         pid,
		Error:       errorMessage,
		Timestamp:   time.Now().UTC(),
		CompletedAt: completedAt,
	})
}

// ExecuteAgent starts an agent run with the specified parameters.
func (a *App) ExecuteAgent(agentID int64, projectPath, task, model string) (*database.AgentRun, error) {
	if a.dbManager == nil || a.providerManager == nil {
		return nil, nil
	}
	agent, err := a.dbManager.GetAgent(agentID)
	if err != nil {
		return nil, err
	}
	run := &database.AgentRun{
		AgentID:     agentID,
		AgentName:   agent.Name,
		AgentIcon:   agent.Icon,
		Task:        task,
		Model:       model,
		ProjectPath: projectPath,
		Status:      "pending",
	}
	runID, err := a.dbManager.CreateAgentRun(run)
	if err != nil {
		return nil, err
	}
	run.ID = runID
	emitAgentRunChanged(a.eventHub, run, "pending", run.PID, nil, "")

	prompt := agent.SystemPrompt
	if task != "" {
		prompt = prompt + "\n\n---\n\nTask: " + task
	}

	config := provider.SessionConfig{
		ProjectPath: projectPath,
		Prompt:      prompt,
		Model:       model,
	}
	if agent.ProviderApiID != "" {
		config.ProviderApiID = agent.ProviderApiID
		if apiCfg, err := a.dbManager.GetProviderApiConfig(agent.ProviderApiID); err == nil && apiCfg != nil {
			config.AuthToken = apiCfg.AuthToken
			config.BaseURL = apiCfg.BaseURL
		}
	}

	sessionID, err := a.providerManager.StartSession("claude", config)
	if err != nil {
		if updateErr := a.dbManager.UpdateAgentRunStatus(runID, "failed", 0, nil, nil); updateErr == nil {
			emitAgentRunChanged(a.eventHub, run, "failed", 0, nil, err.Error())
		}
		return nil, err
	}

	run.SessionID = sessionID
	if err := a.dbManager.UpdateAgentRunSession(runID, sessionID); err != nil {
		return nil, err
	}
	run.Status = "running"
	now := run.CreatedAt
	run.ProcessStartedAt = &now

	if status := a.providerManager.GetSession(sessionID); status != nil {
		run.PID = status.PID
	}

	if err := a.dbManager.UpdateAgentRunStatus(runID, "running", run.PID, run.ProcessStartedAt, nil); err == nil {
		emitAgentRunChanged(a.eventHub, run, "running", run.PID, nil, "")
	}
	return run, nil
}

type claudeActivityCtrlSender struct {
	mgr       *provider.Manager
	sessionID string
}

func (s claudeActivityCtrlSender) SendStopTask(requestID, taskID string) error {
	if s.mgr == nil {
		return fmt.Errorf("provider manager not initialized")
	}
	envelope := map[string]interface{}{
		"type":       "control_request",
		"request_id": requestID,
		"request": map[string]interface{}{
			"subtype": "stop_task",
			"task_id": taskID,
		},
	}
	data, _ := json.Marshal(envelope)
	data = append(data, '\n')
	return s.mgr.WriteStdin(s.sessionID, data)
}
