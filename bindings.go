// bindings.go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"ropcode/internal/claude"
	"ropcode/internal/codex"
	"ropcode/internal/database"
	"ropcode/internal/gemini"
	"ropcode/internal/git"
	"ropcode/internal/github"
	"ropcode/internal/mcp"
	"ropcode/internal/plugin"
	"ropcode/internal/ssh"
	"ropcode/internal/usage"
)



// ===== Window Bindings =====

// ToggleFullscreen toggles the macOS native fullscreen mode
// This uses CGO to call NSWindow.toggleFullScreen directly
// because Wails v2's WindowFullscreen() doesn't work with Frameless windows on macOS
func (a *App) ToggleFullscreen() {
	ToggleNativeFullscreen()
}

// IsFullscreen returns true if the window is in fullscreen mode
func (a *App) IsFullscreen() bool {
	return IsNativeFullscreen()
}

// ===== PTY Bindings =====

// PtySessionInfo contains information about a PTY session
type PtySessionInfo struct {
	SessionID string `json:"session_id"`
	Cwd       string `json:"cwd"`
	Shell     string `json:"shell"`
	Rows      int    `json:"rows"`
	Cols      int    `json:"cols"`
}

// CreatePtySession creates a new PTY terminal session
func (a *App) CreatePtySession(sessionID string, cwd string, rows, cols int, shell string) (*PtySessionInfo, error) {
	session, err := a.ptyManager.CreateSession(sessionID, cwd, rows, cols, shell)
	if err != nil {
		return nil, err
	}

	return &PtySessionInfo{
		SessionID: session.ID,
		Cwd:       session.Cwd,
		Shell:     session.Shell,
		Rows:      session.Rows,
		Cols:      session.Cols,
	}, nil
}

// WriteToPty writes data to a PTY session
func (a *App) WriteToPty(sessionID, data string) error {
	return a.ptyManager.Write(sessionID, data)
}

// ResizePty resizes a PTY session terminal
func (a *App) ResizePty(sessionID string, rows, cols int) error {
	return a.ptyManager.Resize(sessionID, rows, cols)
}

// ClosePtySession closes a PTY session
func (a *App) ClosePtySession(sessionID string) error {
	return a.ptyManager.CloseSession(sessionID)
}

// ListPtySessions returns all active PTY session IDs
func (a *App) ListPtySessions() []string {
	return a.ptyManager.ListSessions()
}

// ===== Process Bindings =====

// ProcessInfo contains information about a process
type ProcessInfo struct {
	Key     string `json:"key"`
	PID     int    `json:"pid"`
	Running bool   `json:"running"`
}

// SpawnProcess starts a new managed process
func (a *App) SpawnProcess(key, command string, args []string, cwd string, env []string) (*ProcessInfo, error) {
	proc, err := a.processManager.Spawn(key, command, args, cwd, env)
	if err != nil {
		return nil, err
	}

	return &ProcessInfo{
		Key:     proc.Key,
		PID:     proc.PID,
		Running: proc.IsRunning(),
	}, nil
}

// KillProcess terminates a process
func (a *App) KillProcess(key string) error {
	return a.processManager.Kill(key)
}

// IsProcessAlive checks if a process is running
func (a *App) IsProcessAlive(key string) bool {
	return a.processManager.IsAlive(key)
}

// ListProcesses returns all active process keys
func (a *App) ListProcesses() []string {
	return a.processManager.List()
}

// ===== Database Bindings =====

// SaveProviderApiConfig saves a provider API configuration
func (a *App) SaveProviderApiConfig(config *database.ProviderApiConfig) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveProviderApiConfig(config)
}

// GetProviderApiConfig retrieves a provider API configuration
func (a *App) GetProviderApiConfig(id string) (*database.ProviderApiConfig, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetProviderApiConfig(id)
}

// GetAllProviderApiConfigs retrieves all provider API configurations
func (a *App) GetAllProviderApiConfigs() ([]*database.ProviderApiConfig, error) {
	if a.dbManager == nil {
		return []*database.ProviderApiConfig{}, nil // Return empty array instead of nil
	}
	configs, err := a.dbManager.GetAllProviderApiConfigs()
	if err != nil {
		return []*database.ProviderApiConfig{}, err
	}
	if configs == nil {
		return []*database.ProviderApiConfig{}, nil
	}
	return configs, nil
}

// DeleteProviderApiConfig deletes a provider API configuration
func (a *App) DeleteProviderApiConfig(id string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteProviderApiConfig(id)
}

// SaveSetting saves a setting
func (a *App) SaveSetting(key, value string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveSetting(key, value)
}

// GetSetting retrieves a setting
func (a *App) GetSetting(key string) (string, error) {
	if a.dbManager == nil {
		return "", nil
	}
	return a.dbManager.GetSetting(key)
}

// CreateProviderApiConfig creates a new provider API configuration
func (a *App) CreateProviderApiConfig(config *database.ProviderApiConfig) error {
	if a.dbManager == nil {
		return nil
	}

	// Generate new UUID for the config
	config.ID = uuid.New().String()

	// If this is being set as default, unset other defaults for the same provider
	if config.IsDefault {
		if err := a.dbManager.ClearDefaultProviderApiConfig(config.ProviderID); err != nil {
			return err
		}
	}

	return a.dbManager.SaveProviderApiConfig(config)
}

// GetProjectProviderApiConfig retrieves provider API config for a project
func (a *App) GetProjectProviderApiConfig(projectPath, providerName string) (*database.ProviderApiConfig, error) {
	if a.dbManager == nil {
		return nil, nil
	}

	// Get project index
	name := filepath.Base(projectPath)
	project, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		return nil, err
	}

	// Find provider info for this provider
	for _, provider := range project.Providers {
		if provider.ProviderID == providerName && provider.ProviderApiID != "" {
			// Get the provider API config
			return a.dbManager.GetProviderApiConfig(provider.ProviderApiID)
		}
	}

	// If no provider-specific config, try to get the default
	return a.dbManager.GetDefaultProviderApiConfig(providerName)
}

// SetProjectProviderApiConfig sets the provider API config for a project or workspace
func (a *App) SetProjectProviderApiConfig(projectPath, providerName string, config *database.ProviderApiConfig) error {
	if a.dbManager == nil {
		return nil
	}

	// Get project index - try direct lookup first
	name := filepath.Base(projectPath)
	project, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		// If not found, try to find the project that contains this workspace
		projects, err2 := a.dbManager.GetAllProjectIndexes()
		if err2 != nil {
			return err2
		}

		workspaceName := name
		for _, p := range projects {
			for i, workspace := range p.Workspaces {
				if workspace.Name == workspaceName {
					// Found workspace, update its provider info
					providerFound := false
					for j, provider := range p.Workspaces[i].Providers {
						if provider.ProviderID == providerName {
							p.Workspaces[i].Providers[j].ProviderApiID = config.ID
							providerFound = true
							break
						}
					}
					if !providerFound {
						// Add new provider info to workspace
						p.Workspaces[i].Providers = append(p.Workspaces[i].Providers, database.ProviderInfo{
							ID:            workspaceName,
							ProviderID:    providerName,
							Path:          projectPath,
							ProviderApiID: config.ID,
						})
					}
					return a.dbManager.SaveProjectIndex(p)
				}
			}
		}
		// Neither project nor workspace found
		return err
	}

	// Find or create provider info for this provider (project level)
	found := false
	for i, provider := range project.Providers {
		if provider.ProviderID == providerName {
			project.Providers[i].ProviderApiID = config.ID
			found = true
			break
		}
	}

	if !found {
		// Add new provider info
		project.Providers = append(project.Providers, database.ProviderInfo{
			ID:            name,
			ProviderID:    providerName,
			Path:          projectPath,
			ProviderApiID: config.ID,
		})
	}

	return a.dbManager.SaveProjectIndex(project)
}

// AddProviderToProject adds a provider to a project
func (a *App) AddProviderToProject(path, provider string) error {
	if a.dbManager == nil {
		return nil
	}

	name := filepath.Base(path)
	project, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		return err
	}

	// Check if provider already exists
	for _, p := range project.Providers {
		if p.ProviderID == provider {
			return nil // Already exists
		}
	}

	// Add new provider
	project.Providers = append(project.Providers, database.ProviderInfo{
		ID:         name,
		ProviderID: provider,
		Path:       path,
	})

	return a.dbManager.SaveProjectIndex(project)
}

// UpdateProjectLastProvider updates the last used provider for a project
func (a *App) UpdateProjectLastProvider(path, provider string) error {
	if a.dbManager == nil {
		return nil
	}

	name := filepath.Base(path)
	project, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		return err
	}

	project.LastProvider = provider
	return a.dbManager.SaveProjectIndex(project)
}

// UpdateWorkspaceLastProvider updates the last used provider for a workspace
func (a *App) UpdateWorkspaceLastProvider(path, provider string) error {
	if a.dbManager == nil {
		return nil
	}

	// Find the project that contains this workspace
	projects, err := a.dbManager.GetAllProjectIndexes()
	if err != nil {
		return err
	}

	workspaceName := filepath.Base(path)
	for _, project := range projects {
		for i, workspace := range project.Workspaces {
			if workspace.Name == workspaceName {
				project.Workspaces[i].LastProvider = provider
				return a.dbManager.SaveProjectIndex(project)
			}
		}
	}

	return nil
}

// UpdateProviderSession updates the session ID for a provider in a project
func (a *App) UpdateProviderSession(path, provider, session string) error {
	if a.dbManager == nil {
		return nil
	}

	name := filepath.Base(path)
	_, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		return err
	}

	// Update the provider info with session ID
	// Note: The ProviderInfo struct doesn't have a SessionID field yet
	// This would need to be added to the models.go if we want to persist session IDs
	// For now, we'll just return nil
	return nil
}

// ===== Session History Bindings =====

// GetSessionMessageIndex returns the message index for a session
func (a *App) GetSessionMessageIndex(projectID, sessionID string) ([]int, error) {
	if a.sessionManager == nil {
		return []int{}, fmt.Errorf("session manager not initialized")
	}
	return a.sessionManager.GetMessageIndex(projectID, sessionID)
}

// GetSessionMessagesRange returns a range of messages from a session
func (a *App) GetSessionMessagesRange(projectID, sessionID string, start, end int) ([]claude.Message, error) {
	if a.sessionManager == nil {
		return []claude.Message{}, fmt.Errorf("session manager not initialized")
	}
	return a.sessionManager.GetMessagesRange(projectID, sessionID, start, end)
}

// StreamSessionOutput streams the output of a session
func (a *App) StreamSessionOutput(projectID, sessionID string) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}

	// Create channels for streaming
	eventChan := make(chan claude.Message, 100)
	errorChan := make(chan error, 1)

	// Start streaming in a goroutine
	go a.sessionManager.StreamSessionOutput(projectID, sessionID, eventChan, errorChan)

	// Forward messages to the frontend via Wails events
	go func() {
		for {
			select {
			case msg, ok := <-eventChan:
				if !ok {
					// Channel closed, streaming complete
					runtime.EventsEmit(a.ctx, "session:stream:complete", map[string]interface{}{
						"sessionId": sessionID,
					})
					return
				}
				// Emit each message to the frontend
				runtime.EventsEmit(a.ctx, "session:stream:message", msg)

			case err := <-errorChan:
				if err != nil {
					runtime.EventsEmit(a.ctx, "session:stream:error", map[string]interface{}{
						"sessionId": sessionID,
						"error":     err.Error(),
					})
				}
				return
			}
		}
	}()

	return nil
}

// LoadSessionHistory loads the history for a session
func (a *App) LoadSessionHistory(sessionID, projectID string) ([]claude.Message, error) {
	if a.sessionManager == nil {
		return []claude.Message{}, fmt.Errorf("session manager not initialized")
	}
	return a.sessionManager.LoadSessionHistory(projectID, sessionID)
}

// LoadProviderSessionHistory loads the history for a session based on provider type
func (a *App) LoadProviderSessionHistory(sessionID, projectID, provider string) ([]claude.Message, error) {
	log.Printf("[LoadProviderSessionHistory] Loading history for provider=%s, session=%s, project=%s", provider, sessionID, projectID)

	switch provider {
	case "codex":
		// Load from Codex sessions directory
		codexDir, err := codex.CodexDir()
		if err != nil {
			return []claude.Message{}, fmt.Errorf("failed to get codex directory: %w", err)
		}
		return codex.LoadSessionHistory(codexDir, projectID, sessionID)

	case "gemini":
		// Load from Gemini sessions directory
		geminiDir, err := gemini.GeminiDir()
		if err != nil {
			return []claude.Message{}, fmt.Errorf("failed to get gemini directory: %w", err)
		}
		return gemini.LoadSessionHistory(geminiDir, projectID, sessionID)

	case "claude":
		fallthrough
	default:
		// Load from Claude sessions directory
		if a.sessionManager == nil {
			return []claude.Message{}, fmt.Errorf("session manager not initialized")
		}
		return a.sessionManager.LoadSessionHistory(projectID, sessionID)
	}
}

// LoadAgentSessionHistory loads the history for an agent session
func (a *App) LoadAgentSessionHistory(sessionID string) ([]claude.Message, error) {
	if a.sessionManager == nil {
		return []claude.Message{}, fmt.Errorf("session manager not initialized")
	}
	return a.sessionManager.LoadAgentSessionHistory(sessionID)
}

// ProviderSession represents a session from any provider
type ProviderSession struct {
	ID               string `json:"id"`
	ProjectID        string `json:"project_id"`
	ProjectPath      string `json:"project_path"`
	CreatedAt        int64  `json:"created_at"`
	MessageTimestamp string `json:"message_timestamp,omitempty"`
}

// ListProviderSessions lists sessions for a project based on provider type
func (a *App) ListProviderSessions(projectPath, provider string) ([]ProviderSession, error) {
	log.Printf("[ListProviderSessions] Listing sessions for provider=%s, project=%s", provider, projectPath)

	switch provider {
	case "codex":
		// List from Codex sessions directory
		codexDir, err := codex.CodexDir()
		if err != nil {
			log.Printf("[ListProviderSessions] Failed to get codex directory: %v", err)
			return []ProviderSession{}, nil
		}
		codexSessions, err := codex.ListProjectSessions(codexDir, projectPath)
		if err != nil {
			log.Printf("[ListProviderSessions] Failed to list codex sessions: %v", err)
			return []ProviderSession{}, nil
		}
		// Convert to ProviderSession
		sessions := make([]ProviderSession, len(codexSessions))
		for i, s := range codexSessions {
			sessions[i] = ProviderSession{
				ID:               s.ID,
				ProjectID:        s.ProjectID,
				ProjectPath:      s.ProjectPath,
				CreatedAt:        s.CreatedAt,
				MessageTimestamp: s.MessageTimestamp,
			}
		}
		return sessions, nil

	case "gemini":
		// TODO: Implement gemini session listing
		log.Printf("[ListProviderSessions] Gemini session listing not yet implemented")
		return []ProviderSession{}, nil

	case "claude":
		fallthrough
	default:
		// For Claude, we use the existing session system via database
		// This should not be called for Claude - use getProjectSessions instead
		log.Printf("[ListProviderSessions] Claude sessions should use getProjectSessions API")
		return []ProviderSession{}, nil
	}
}

// ===== Utility Bindings =====

// GetConfig returns the application config
func (a *App) GetConfig() map[string]string {
	if a.config == nil {
		return nil
	}
	return map[string]string{
		"home_dir":      a.config.HomeDir,
		"ropcode_dir":   a.config.RopcodeDir,
		"claude_dir":    a.config.ClaudeDir,
		"database_path": a.config.DatabasePath,
		"log_dir":       a.config.LogDir,
	}
}

// GetHomeDirectory returns the user's home directory
func (a *App) GetHomeDirectory() string {
	if a.config == nil {
		home, _ := os.UserHomeDir()
		return home
	}
	return a.config.HomeDir
}

// ===== Dialog Bindings =====

// OpenDirectoryDialog opens a native directory selection dialog
func (a *App) OpenDirectoryDialog(title, defaultPath string) (string, error) {
	homeDir := a.GetHomeDirectory()
	if defaultPath == "" {
		defaultPath = homeDir
	}

	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		DefaultDirectory:     defaultPath,
		Title:                title,
		CanCreateDirectories: true,
		ShowHiddenFiles:      false,
	})
}

// OpenFileDialog opens a native file selection dialog
func (a *App) OpenFileDialog(title, defaultPath string, filters []map[string]interface{}) (string, error) {
	homeDir := a.GetHomeDirectory()
	if defaultPath == "" {
		defaultPath = homeDir
	}

	// Note: File filters are disabled on macOS due to Wails bug causing crash
	// when NSOpenPanel receives certain filter patterns.
	// See: https://github.com/wailsapp/wails/issues/2455
	opts := runtime.OpenDialogOptions{
		DefaultDirectory: defaultPath,
		Title:            title,
	}
	return runtime.OpenFileDialog(a.ctx, opts)
}

// ===== Project Index Bindings =====

// ListProjects returns all project indexes
func (a *App) ListProjects() ([]*database.ProjectIndex, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	projects, err := a.dbManager.GetAllProjectIndexes()
	if err != nil {
		return nil, err
	}

	// Migration: detect and fill has_git_support for projects that don't have it
	for _, project := range projects {
		if project.HasGitSupport == nil {
			// Get project path from first provider
			if len(project.Providers) > 0 {
				path := project.Providers[0].Path
				_, gitErr := git.Open(path)
				hasGit := gitErr == nil
				project.HasGitSupport = &hasGit
				// Save the updated project
				a.dbManager.SaveProjectIndex(project)
			}
		}
	}

	return projects, nil
}

// GetProjectIndex retrieves a project index by name
func (a *App) GetProjectIndex(name string) (*database.ProjectIndex, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetProjectIndex(name)
}

// SaveProjectIndex saves or updates a project index
func (a *App) SaveProjectIndex(project *database.ProjectIndex) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.SaveProjectIndex(project)
}

// DeleteProjectIndex deletes a project index by name
func (a *App) DeleteProjectIndex(name string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteProjectIndex(name)
}

// ===== Git Bindings =====

// GitRepoStatus contains git repository status information
type GitRepoStatus struct {
	Branch    string           `json:"branch"`
	Modified  []git.FileStatus `json:"modified"`
	Staged    []git.FileStatus `json:"staged"`
	Untracked []git.FileStatus `json:"untracked"`
	IsClean   bool             `json:"is_clean"`
}

// GetGitStatus returns the git status for a repository path
func (a *App) GetGitStatus(path string) (*GitRepoStatus, error) {
	repo, err := git.Open(path)
	if err != nil {
		return nil, err
	}

	status, err := repo.Status()
	if err != nil {
		return nil, err
	}

	return &GitRepoStatus{
		Branch:    status.Branch,
		Modified:  status.Modified,
		Staged:    status.Staged,
		Untracked: status.Untracked,
		IsClean:   status.IsClean,
	}, nil
}

// GetCurrentBranch returns the current git branch for a repository path
func (a *App) GetCurrentBranch(path string) (string, error) {
	repo, err := git.Open(path)
	if err != nil {
		return "", err
	}
	return repo.CurrentBranch()
}

// GetGitDiff returns the diff for a repository
func (a *App) GetGitDiff(path string, cached bool) (string, error) {
	repo, err := git.Open(path)
	if err != nil {
		return "", err
	}
	return repo.Diff(cached)
}

// IsGitRepository checks if a path is a git repository
func (a *App) IsGitRepository(path string) bool {
	_, err := git.Open(path)
	return err == nil
}

// WorktreeInfo contains worktree detection information
type WorktreeInfo struct {
	CurrentPath     string `json:"current_path"`
	RootPath        string `json:"root_path"`
	MainBranch      string `json:"main_branch"`
	IsWorktreeChild bool   `json:"is_worktree"`
}

// DetectWorktree detects if the path is a git worktree
func (a *App) DetectWorktree(path string) (*WorktreeInfo, error) {
	// Check if .git is a file (worktree) or directory (main repo)
	gitPath := filepath.Join(path, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return &WorktreeInfo{
			CurrentPath:     path,
			RootPath:        path,
			IsWorktreeChild: false,
		}, nil
	}

	isWorktree := !info.IsDir()

	// If it's a worktree, try to find the main repo
	rootPath := path
	mainBranch := "main"
	if isWorktree {
		// Read the .git file to find the main repo path
		data, err := os.ReadFile(gitPath)
		if err == nil {
			content := strings.TrimSpace(string(data))
			if strings.HasPrefix(content, "gitdir:") {
				gitDir := strings.TrimSpace(strings.TrimPrefix(content, "gitdir:"))
				// The gitdir points to .git/worktrees/<name>, go up to find main repo
				if strings.Contains(gitDir, "worktrees") {
					parts := strings.Split(gitDir, "worktrees")
					if len(parts) > 0 {
						mainGitDir := strings.TrimSuffix(parts[0], string(filepath.Separator))
						rootPath = filepath.Dir(mainGitDir)
					}
				}
			}
		}
	}

	// Try to get the main branch
	repo, err := git.Open(rootPath)
	if err == nil {
		if branch, err := repo.CurrentBranch(); err == nil {
			mainBranch = branch
		}
	}

	return &WorktreeInfo{
		CurrentPath:     path,
		RootPath:        rootPath,
		MainBranch:      mainBranch,
		IsWorktreeChild: isWorktree,
	}, nil
}

// PushToMainWorktree merges the current worktree branch into the main worktree's branch
// This is a local merge operation, not a push to remote
func (a *App) PushToMainWorktree(path string) (string, error) {
	// 1. Detect worktree info
	worktreeInfo, err := a.DetectWorktree(path)
	if err != nil {
		return "", err
	}

	if !worktreeInfo.IsWorktreeChild {
		return "", fmt.Errorf("current directory is not a worktree child")
	}

	// 2. Get current branch name
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch := strings.TrimSpace(string(output))

	// 3. Check if main worktree has uncommitted changes
	cmd = exec.Command("git", "status", "--porcelain")
	cmd.Dir = worktreeInfo.RootPath
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to check main worktree status: %w", err)
	}
	if len(strings.TrimSpace(string(output))) > 0 {
		return "", fmt.Errorf("main worktree has uncommitted changes. Please commit or stash them first")
	}

	// 4. Get the SHA of current branch (to avoid "branch is checked out" error)
	cmd = exec.Command("git", "rev-parse", currentBranch)
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get branch SHA: %w", err)
	}
	branchSHA := strings.TrimSpace(string(output))

	// 5. Perform merge in main worktree using SHA instead of branch name
	// This avoids the "cannot merge branch that is checked out in a worktree" error
	cmd = exec.Command("git", "merge", "--no-edit", branchSHA, "-m", "Merge from worktree: "+currentBranch)
	cmd.Dir = worktreeInfo.RootPath
	output, err = cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		// Check if it's a conflict
		if strings.Contains(outputStr, "CONFLICT") || strings.Contains(outputStr, "conflict") {
			// Abort the merge
			abortCmd := exec.Command("git", "merge", "--abort")
			abortCmd.Dir = worktreeInfo.RootPath
			abortCmd.Run()

			return "", fmt.Errorf("cannot push to main: merge would result in conflicts.\n\n" +
				"The main branch has changes that conflict with your worktree branch.\n\n" +
				"To resolve this:\n" +
				"1. In your worktree, merge the main branch first:\n" +
				"   cd " + path + "\n" +
				"   git merge " + worktreeInfo.MainBranch + "\n" +
				"2. Resolve any conflicts\n" +
				"3. Commit the merge\n" +
				"4. Then try pushing to main again")
		}

		// Check if already up to date
		if strings.Contains(outputStr, "Already up to date") {
			return "Already up to date. Nothing to push.", nil
		}

		return "", fmt.Errorf("failed to merge: %s", outputStr)
	}

	return fmt.Sprintf("Successfully pushed %s to %s at %s", currentBranch, worktreeInfo.MainBranch, worktreeInfo.RootPath), nil
}

// GetUnpushedCommitsCount returns the count of commits not pushed to main worktree
// This compares the current branch against the main worktree's branch (not remote)
func (a *App) GetUnpushedCommitsCount(path string) (int, error) {
	// 1. Detect worktree info
	worktreeInfo, err := a.DetectWorktree(path)
	if err != nil {
		return 0, err
	}

	// If not a worktree child, return 0
	if !worktreeInfo.IsWorktreeChild {
		return 0, nil
	}

	// 2. Get current branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return 0, nil
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return 0, nil
	}

	// 3. Count commits between main branch and current branch
	// This counts commits in current branch that are not in main branch
	cmd = exec.Command("git", "rev-list", "--count", fmt.Sprintf("%s..%s", worktreeInfo.MainBranch, currentBranch))
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return 0, nil
	}

	var count int
	_, err = fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
	if err != nil {
		return 0, err
	}

	return count, nil
}

// PushToRemote pushes changes to the remote repository
// Handles upstream setup for new branches and provides helpful error messages
func (a *App) PushToRemote(path string) (string, error) {
	// 1. Get current branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return "", fmt.Errorf("not on a valid branch")
	}

	// 2. Check if remote 'origin' exists
	cmd = exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = path
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("no remote 'origin' configured")
	}

	// 3. Fetch latest from remote
	cmd = exec.Command("git", "fetch", "origin")
	cmd.Dir = path
	cmd.Run() // Ignore fetch errors, push might still work

	// 4. Check if remote branch exists
	remoteBranch := fmt.Sprintf("refs/remotes/origin/%s", currentBranch)
	cmd = exec.Command("git", "rev-parse", "--verify", "--quiet", remoteBranch)
	cmd.Dir = path
	remoteBranchExists := cmd.Run() == nil

	// 5. Push with or without upstream setup
	var pushArgs []string
	if remoteBranchExists {
		pushArgs = []string{"push", "origin", currentBranch}
	} else {
		// Set upstream for new branch
		pushArgs = []string{"push", "-u", "origin", currentBranch}
	}

	cmd = exec.Command("git", pushArgs...)
	cmd.Dir = path
	output, err = cmd.CombinedOutput()
	if err != nil {
		outputStr := string(output)
		if strings.Contains(outputStr, "non-fast-forward") || strings.Contains(outputStr, "rejected") {
			return "", fmt.Errorf("push rejected. The remote contains work you don't have locally.\n" +
				"Please pull the latest changes first:\n" +
				"  git pull origin " + currentBranch + "\n" +
				"Then try pushing again")
		}
		return "", fmt.Errorf("push failed: %s", outputStr)
	}

	return fmt.Sprintf("Successfully pushed %s to origin", currentBranch), nil
}

// GetUnpushedToRemoteCount returns the count of commits not pushed to remote
// If the remote branch doesn't exist, returns the total number of commits on the branch
func (a *App) GetUnpushedToRemoteCount(path string) (int, error) {
	// 1. Get current branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = path
	output, err := cmd.Output()
	if err != nil {
		return 0, nil
	}
	currentBranch := strings.TrimSpace(string(output))
	if currentBranch == "" || currentBranch == "HEAD" {
		return 0, nil
	}

	// 2. Check if remote branch exists
	remoteBranch := fmt.Sprintf("refs/remotes/origin/%s", currentBranch)
	cmd = exec.Command("git", "rev-parse", "--verify", "--quiet", remoteBranch)
	cmd.Dir = path
	err = cmd.Run()

	if err != nil {
		// Remote branch doesn't exist, count total commits on this branch
		cmd = exec.Command("git", "rev-list", "--count", currentBranch)
		cmd.Dir = path
		output, err = cmd.Output()
		if err != nil {
			return 0, nil
		}

		var count int
		_, err = fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
		if err != nil {
			return 0, err
		}
		return count, nil
	}

	// 3. Remote branch exists, count commits ahead of remote
	cmd = exec.Command("git", "rev-list", "--count", fmt.Sprintf("%s..HEAD", remoteBranch))
	cmd.Dir = path
	output, err = cmd.Output()
	if err != nil {
		return 0, nil
	}

	var count int
	_, err = fmt.Sscanf(strings.TrimSpace(string(output)), "%d", &count)
	if err != nil {
		return 0, err
	}

	return count, nil
}

// CheckWorkspaceClean checks if the workspace is clean (no uncommitted changes and no unpushed commits)
// Uses git command instead of go-git because go-git doesn't handle worktrees correctly
func (a *App) CheckWorkspaceClean(path string) error {
	// 1. Check for uncommitted changes using git status --porcelain
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = path

	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to check workspace status: %w", err)
	}

	if len(strings.TrimSpace(string(output))) > 0 {
		return fmt.Errorf("workspace has uncommitted changes")
	}

	// 2. Check for unpushed commits (commits not merged to main branch)
	unpushedCount, err := a.GetUnpushedCommitsCount(path)
	if err != nil {
		// If we can't check unpushed commits, don't block deletion
		return nil
	}

	if unpushedCount > 0 {
		return fmt.Errorf("workspace has %d unpushed commit(s) not merged to main branch", unpushedCount)
	}

	return nil
}

// CleanupWorkspace cleans up the workspace by:
// 1. Resetting all uncommitted changes (staged and unstaged)
// 2. Removing all untracked files and directories
// 3. Resetting to remote branch (if exists) or main branch (if worktree)
func (a *App) CleanupWorkspace(path string) (string, error) {
	repo, err := git.Open(path)
	if err != nil {
		return "", err
	}

	var cleanupOperations []string

	// 1. Get current branch
	currentBranch, err := repo.CurrentBranch()
	if err != nil || currentBranch == "" || currentBranch == "HEAD" {
		return "", fmt.Errorf("not on a valid branch")
	}

	// 2. Reset all uncommitted changes (git reset --hard HEAD)
	_, err = repo.RunGitCommand("reset", "--hard", "HEAD")
	if err != nil {
		return "", fmt.Errorf("failed to reset changes: %w", err)
	}
	cleanupOperations = append(cleanupOperations, "Reset all uncommitted changes")

	// 3. Clean untracked files and directories (git clean -fd)
	_, err = repo.RunGitCommand("clean", "-fd")
	if err != nil {
		return "", fmt.Errorf("failed to clean untracked files: %w", err)
	}
	cleanupOperations = append(cleanupOperations, "Removed all untracked files and directories")

	// 4. Check if remote branch exists
	remoteBranch := fmt.Sprintf("origin/%s", currentBranch)
	remoteBranchFull := fmt.Sprintf("refs/remotes/%s", remoteBranch)

	// Check if remote branch exists using git rev-parse
	cmd := exec.Command("git", "rev-parse", "--verify", remoteBranchFull)
	cmd.Dir = path
	remoteBranchExists := cmd.Run() == nil

	if remoteBranchExists {
		// 5. Reset to remote branch to delete unpushed commits
		_, err = repo.RunGitCommand("reset", "--hard", remoteBranchFull)
		if err != nil {
			return "", fmt.Errorf("failed to reset to remote branch: %w", err)
		}
		cleanupOperations = append(cleanupOperations, fmt.Sprintf("Reset branch '%s' to match remote '%s'", currentBranch, remoteBranch))
	} else {
		// 6. Check if this is a worktree child
		worktreeInfo, err := a.DetectWorktree(path)
		if err == nil && worktreeInfo.IsWorktreeChild {
			// Reset to main branch
			_, err = repo.RunGitCommand("reset", "--hard", worktreeInfo.MainBranch)
			if err != nil {
				return "", fmt.Errorf("failed to reset to main branch: %w", err)
			}
			cleanupOperations = append(cleanupOperations, fmt.Sprintf("Reset worktree branch '%s' to match main branch '%s'", currentBranch, worktreeInfo.MainBranch))
		} else {
			cleanupOperations = append(cleanupOperations, "No remote branch found, keeping local commits")
		}
	}

	cleanupSummary := strings.Join(cleanupOperations, "\n")
	return fmt.Sprintf("Workspace cleanup completed successfully:\n%s", cleanupSummary), nil
}

// UpdateWorkspaceBranch updates the workspace branch information
func (a *App) UpdateWorkspaceBranch(path, branch string) error {
	// This is a metadata update operation
	// In the original implementation, this would update the project index
	// For now, we just validate that the path is a git repository
	_, err := git.Open(path)
	return err
}

// InitLocalGit initializes a local git repository
func (a *App) InitLocalGit(path string, commitAll bool) error {
	repo, err := git.Open(path)
	if err != nil {
		// If repo doesn't exist, initialize it
		_, err = exec.Command("git", "init", path).CombinedOutput()
		if err != nil {
			return err
		}

		repo, err = git.Open(path)
		if err != nil {
			return err
		}
	}

	if commitAll {
		// Add all files
		_, err = repo.RunGitCommand("add", ".")
		if err != nil {
			return err
		}

		// Commit
		_, err = repo.RunGitCommand("commit", "-m", "Initial commit")
		if err != nil {
			return err
		}
	}

	return nil
}

// ===== File System Bindings =====

// FileEntry represents a file or directory
type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"is_directory"`
	Size        int64  `json:"size"`
	Extension   string `json:"extension,omitempty"`
}

// ListDirectoryContents lists files and directories in a path
func (a *App) ListDirectoryContents(path string) ([]FileEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	result := make([]FileEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		ext := ""
		if !entry.IsDir() {
			ext = strings.TrimPrefix(filepath.Ext(entry.Name()), ".")
		}

		result = append(result, FileEntry{
			Name:        entry.Name(),
			Path:        filepath.Join(path, entry.Name()),
			IsDirectory: entry.IsDir(),
			Size:        info.Size(),
			Extension:   ext,
		})
	}

	return result, nil
}

// ReadFile reads the content of a file
func (a *App) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile writes content to a file
func (a *App) WriteFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// SearchFiles searches for files matching a query in a base path
func (a *App) SearchFiles(basePath, query string) ([]FileEntry, error) {
	var results []FileEntry
	query = strings.ToLower(query)

	err := filepath.WalkDir(basePath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip hidden directories and common ignored dirs
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "__pycache__" {
				return filepath.SkipDir
			}
		}

		// Check if name matches query
		if strings.Contains(strings.ToLower(d.Name()), query) {
			info, err := d.Info()
			if err != nil {
				return nil
			}

			ext := ""
			if !d.IsDir() {
				ext = strings.TrimPrefix(filepath.Ext(d.Name()), ".")
			}

			results = append(results, FileEntry{
				Name:        d.Name(),
				Path:        path,
				IsDirectory: d.IsDir(),
				Size:        info.Size(),
				Extension:   ext,
			})

			// Limit results
			if len(results) >= 100 {
				return filepath.SkipAll
			}
		}

		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return nil, err
	}

	return results, nil
}

// ===== Claude Session Bindings =====

// ExecuteClaudeCode starts a new Claude Code session
func (a *App) ExecuteClaudeCode(projectPath, prompt, model string, sessionID, providerApiID string) (string, error) {
	if a.claudeManager == nil {
		return "", nil
	}

	config := claude.SessionConfig{
		ProjectPath:   projectPath,
		Prompt:        prompt,
		Model:         model,
		ProviderApiID: providerApiID,
		SessionID:     sessionID,
	}

	// Fetch API configuration if providerApiID is specified
	if providerApiID != "" && a.dbManager != nil {
		apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
		if err == nil && apiConfig != nil {
			config.BaseURL = apiConfig.BaseURL
			config.AuthToken = apiConfig.AuthToken
		}
	}

	return a.claudeManager.StartSession(config)
}

// StartProviderSession starts a new provider session based on the provider type
func (a *App) StartProviderSession(provider, projectPath, prompt, model, providerApiID string) (string, error) {
	switch provider {
	case "claude":
		return a.ExecuteClaudeCode(projectPath, prompt, model, "", providerApiID)

	case "gemini":
		if a.geminiManager == nil {
			return "", fmt.Errorf("gemini manager not initialized")
		}
		config := gemini.SessionConfig{
			ProjectPath:   projectPath,
			Prompt:        prompt,
			Model:         model,
			ProviderApiID: providerApiID,
		}
		// Fetch API configuration if providerApiID is specified
		if providerApiID != "" && a.dbManager != nil {
			apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
			if err == nil && apiConfig != nil {
				config.AuthToken = apiConfig.AuthToken
				config.BaseURL = apiConfig.BaseURL
			}
		}
		return a.geminiManager.StartSession(config)

	case "codex":
		if a.codexManager == nil {
			return "", fmt.Errorf("codex manager not initialized")
		}
		// Codex gets API key from ~/.claude/settings.json env.CRS_OAI_KEY
		// It does not use database ProviderApiConfig
		config := codex.SessionConfig{
			ProjectPath:   projectPath,
			Prompt:        prompt,
			Model:         model,
			ProviderApiID: providerApiID,
		}
		return a.codexManager.StartSession(config)

	default:
		// Fallback to Claude for unknown providers
		return a.ExecuteClaudeCode(projectPath, prompt, model, "", providerApiID)
	}
}

// ResumeProviderSession resumes an existing provider session based on the provider type
func (a *App) ResumeProviderSession(provider, projectPath, prompt, model, sessionID, providerApiID string) (string, error) {
	switch provider {
	case "claude":
		return a.ResumeClaudeCode(projectPath, prompt, model, sessionID, providerApiID)

	case "gemini":
		if a.geminiManager == nil {
			return "", fmt.Errorf("gemini manager not initialized")
		}
		config := gemini.SessionConfig{
			ProjectPath:   projectPath,
			Prompt:        prompt,
			Model:         model,
			ProviderApiID: providerApiID,
			SessionID:     sessionID,
			Resume:        true,
		}
		// Fetch API configuration if providerApiID is specified
		if providerApiID != "" && a.dbManager != nil {
			apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
			if err == nil && apiConfig != nil {
				config.AuthToken = apiConfig.AuthToken
				config.BaseURL = apiConfig.BaseURL
			}
		}
		return a.geminiManager.StartSession(config)

	case "codex":
		if a.codexManager == nil {
			return "", fmt.Errorf("codex manager not initialized")
		}
		// Codex gets API key from ~/.claude/settings.json env.CRS_OAI_KEY
		// It does not use database ProviderApiConfig
		config := codex.SessionConfig{
			ProjectPath:   projectPath,
			Prompt:        prompt,
			Model:         model,
			ProviderApiID: providerApiID,
			SessionID:     sessionID,
			Resume:        true,
		}
		return a.codexManager.StartSession(config)

	default:
		// Fallback to Claude for unknown providers
		return a.ResumeClaudeCode(projectPath, prompt, model, sessionID, providerApiID)
	}
}

// ResumeClaudeCode resumes an existing Claude session
func (a *App) ResumeClaudeCode(projectPath, prompt, model, sessionID, providerApiID string) (string, error) {
	if a.claudeManager == nil {
		return "", nil
	}

	config := claude.SessionConfig{
		ProjectPath:   projectPath,
		Prompt:        prompt,
		Model:         model,
		ProviderApiID: providerApiID,
		SessionID:     sessionID,
		Resume:        true,
	}

	// Fetch API configuration if providerApiID is specified
	if providerApiID != "" && a.dbManager != nil {
		apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
		if err == nil && apiConfig != nil {
			config.BaseURL = apiConfig.BaseURL
			config.AuthToken = apiConfig.AuthToken
		}
	}

	return a.claudeManager.StartSession(config)
}

// ContinueClaudeCode continues an existing session
func (a *App) ContinueClaudeCode(projectPath, prompt, model, sessionID, providerApiID string) (string, error) {
	if a.claudeManager == nil {
		return "", nil
	}

	config := claude.SessionConfig{
		ProjectPath:   projectPath,
		Prompt:        prompt,
		Model:         model,
		ProviderApiID: providerApiID,
		SessionID:     sessionID,
		Continue:      true,
	}

	// Fetch API configuration if providerApiID is specified
	if providerApiID != "" && a.dbManager != nil {
		apiConfig, err := a.dbManager.GetProviderApiConfig(providerApiID)
		if err == nil && apiConfig != nil {
			config.BaseURL = apiConfig.BaseURL
			config.AuthToken = apiConfig.AuthToken
		}
	}

	return a.claudeManager.StartSession(config)
}

// CancelClaudeExecution cancels a running session
func (a *App) CancelClaudeExecution(sessionID string) error {
	if a.claudeManager == nil {
		return nil
	}
	return a.claudeManager.TerminateSession(sessionID)
}

// CancelClaudeExecutionByProject cancels any provider session by project path
// This method tries to stop any running provider (claude, codex, gemini) for the given project
func (a *App) CancelClaudeExecutionByProject(projectPath string) error {
	// Try all known providers
	providers := []struct {
		name    string
		manager interface {
			IsRunningForProject(string) bool
			TerminateByProject(string) error
		}
	}{
		{"claude", a.claudeManager},
		{"gemini", a.geminiManager},
		{"codex", a.codexManager},
	}

	for _, p := range providers {
		if p.manager == nil {
			continue
		}
		if p.manager.IsRunningForProject(projectPath) {
			log.Printf("[CancelClaudeExecutionByProject] Found running %s session for project: %s", p.name, projectPath)
			if err := p.manager.TerminateByProject(projectPath); err != nil {
				log.Printf("[CancelClaudeExecutionByProject] Failed to terminate %s session: %v", p.name, err)
				return err
			}
			log.Printf("[CancelClaudeExecutionByProject] Successfully cancelled %s execution for project: %s", p.name, projectPath)
			return nil
		}
	}

	log.Printf("[CancelClaudeExecutionByProject] No active provider session for project: %s", projectPath)
	return nil
}

// IsClaudeSessionRunning checks if a session is running
func (a *App) IsClaudeSessionRunning(sessionID string) bool {
	if a.claudeManager == nil {
		return false
	}
	return a.claudeManager.IsRunning(sessionID)
}

// IsClaudeSessionRunningForProject checks if any session is running for a project
func (a *App) IsClaudeSessionRunningForProject(projectPath string, provider string) bool {
	switch provider {
	case "gemini":
		if a.geminiManager == nil {
			return false
		}
		return a.geminiManager.IsRunningForProject(projectPath)
	case "codex":
		if a.codexManager == nil {
			return false
		}
		return a.codexManager.IsRunningForProject(projectPath)
	default:
		if a.claudeManager == nil {
			return false
		}
		return a.claudeManager.IsRunningForProject(projectPath)
	}
}

// ListRunningClaudeSessions returns all running sessions
func (a *App) ListRunningClaudeSessions() []*claude.SessionStatus {
	if a.claudeManager == nil {
		return nil
	}
	return a.claudeManager.ListRunningSessions()
}

// GetClaudeSessionOutput returns the output of a session
func (a *App) GetClaudeSessionOutput(sessionID string) (string, error) {
	if a.claudeManager == nil {
		return "", nil
	}
	return a.claudeManager.GetSessionOutput(sessionID)
}

// GetClaudeBinaryPath returns the configured binary path
func (a *App) GetClaudeBinaryPath() string {
	if a.claudeManager == nil {
		return ""
	}
	return a.claudeManager.GetBinaryPath()
}

// SetClaudeBinaryPath sets the binary path for both claude manager and mcp manager
func (a *App) SetClaudeBinaryPath(path string) {
	if a.claudeManager != nil {
		a.claudeManager.SetBinaryPath(path)
	}
	if a.mcpManager != nil {
		a.mcpManager.SetClaudeBinary(path)
	}
}

// ===== Claude Settings Bindings =====

// GetClaudeSettings returns the Claude settings from ~/.claude/settings.json
func (a *App) GetClaudeSettings() (map[string]interface{}, error) {
	if a.config == nil {
		return nil, nil
	}
	settingsPath := filepath.Join(a.config.ClaudeDir, "settings.json")
	return claude.LoadSettings(settingsPath)
}

// SaveClaudeSettings saves the Claude settings
func (a *App) SaveClaudeSettings(settings map[string]interface{}) error {
	runtime.LogDebug(a.ctx, "SaveClaudeSettings called")
	if a.config == nil {
		runtime.LogWarning(a.ctx, "SaveClaudeSettings: config is nil")
		return nil
	}
	settingsPath := filepath.Join(a.config.ClaudeDir, "settings.json")
	runtime.LogDebug(a.ctx, fmt.Sprintf("SaveClaudeSettings: saving to %s", settingsPath))
	err := claude.SaveSettings(settingsPath, settings)
	if err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("SaveClaudeSettings: error saving: %v", err))
	} else {
		runtime.LogDebug(a.ctx, "SaveClaudeSettings: saved successfully")
	}
	return err
}

// GetSystemPrompt returns the global system prompt from ~/.claude/CLAUDE.md
func (a *App) GetSystemPrompt() (string, error) {
	if a.config == nil {
		return "", nil
	}
	return claude.GetSystemPrompt(a.config.ClaudeDir)
}

// SaveSystemPrompt saves the global system prompt
func (a *App) SaveSystemPrompt(content string) error {
	if a.config == nil {
		return nil
	}
	return claude.SaveSystemPrompt(a.config.ClaudeDir, content)
}

// FindClaudeMdFiles finds all CLAUDE.md files in a project
func (a *App) FindClaudeMdFiles(projectPath string) ([]claude.ClaudeMdFile, error) {
	return claude.FindClaudeMdFiles(projectPath)
}

// ReadClaudeMdFile reads a CLAUDE.md file content
func (a *App) ReadClaudeMdFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveClaudeMdFile saves content to a CLAUDE.md file
func (a *App) SaveClaudeMdFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// GetProviderSystemPrompt returns the provider system prompt from ~/.claude/providers/{provider}.md
func (a *App) GetProviderSystemPrompt(provider string) (string, error) {
	if a.config == nil {
		return "", nil
	}
	return claude.GetProviderSystemPrompt(a.config.ClaudeDir, provider)
}

// SaveProviderSystemPrompt saves the provider system prompt to ~/.claude/providers/{provider}.md
func (a *App) SaveProviderSystemPrompt(provider, content string) (string, error) {
	if a.config == nil {
		return "", nil
	}
	return claude.SaveProviderSystemPrompt(a.config.ClaudeDir, provider, content)
}

// ===== Agent Bindings =====

// ListAgents returns all agents
func (a *App) ListAgents() ([]*database.Agent, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.ListAgents()
}

// GetAgent returns a single agent
func (a *App) GetAgent(id int64) (*database.Agent, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetAgent(id)
}

// CreateAgent creates a new agent
func (a *App) CreateAgent(name, icon, systemPrompt, defaultTask, model, providerApiID, hooks string) (int64, error) {
	if a.dbManager == nil {
		return 0, nil
	}
	agent := &database.Agent{
		Name:          name,
		Icon:          icon,
		SystemPrompt:  systemPrompt,
		DefaultTask:   defaultTask,
		Model:         model,
		ProviderApiID: providerApiID,
		Hooks:         hooks,
	}
	return a.dbManager.CreateAgent(agent)
}

// UpdateAgent updates an existing agent
func (a *App) UpdateAgent(id int64, name, icon, systemPrompt, defaultTask, model, providerApiID, hooks string) error {
	if a.dbManager == nil {
		return nil
	}
	agent := &database.Agent{
		ID:            id,
		Name:          name,
		Icon:          icon,
		SystemPrompt:  systemPrompt,
		DefaultTask:   defaultTask,
		Model:         model,
		ProviderApiID: providerApiID,
		Hooks:         hooks,
	}
	return a.dbManager.UpdateAgent(agent)
}

// DeleteAgent deletes an agent
func (a *App) DeleteAgent(id int64) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteAgent(id)
}

// ExportAgent exports an agent as JSON string
func (a *App) ExportAgent(id int64) (string, error) {
	if a.dbManager == nil {
		return "", nil
	}
	return a.dbManager.ExportAgent(id)
}

// ExportAgentToFile exports an agent to a file
func (a *App) ExportAgentToFile(id int64, path string) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.ExportAgentToFile(id, path)
}

// ImportAgent imports an agent from JSON string
func (a *App) ImportAgent(data string) (*database.Agent, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.ImportAgent(data)
}

// ImportAgentFromFile imports an agent from a file
func (a *App) ImportAgentFromFile(path string) (*database.Agent, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.ImportAgentFromFile(path)
}

// ===== Slash Commands Bindings =====

// ListSlashCommands lists all slash commands (global + project level)
func (a *App) ListSlashCommands(projectPath string) ([]claude.SlashCommand, error) {
	return claude.ListSlashCommands(projectPath)
}

// GetSlashCommand retrieves a specific slash command by name
func (a *App) GetSlashCommand(name, projectPath string) (*claude.SlashCommand, error) {
	return claude.GetSlashCommand(name, projectPath)
}

// SaveSlashCommand saves a slash command to the appropriate location
func (a *App) SaveSlashCommand(name, content, scope, projectPath string) error {
	return claude.SaveSlashCommand(name, content, scope, projectPath)
}

// DeleteSlashCommand deletes a slash command
func (a *App) DeleteSlashCommand(name, scope, projectPath string) error {
	return claude.DeleteSlashCommand(name, scope, projectPath)
}

// ===== Claude Config Agents Bindings =====

// ListClaudeConfigAgents lists all Claude config agents (user + project level)
func (a *App) ListClaudeConfigAgents(projectPath string) ([]claude.ClaudeAgent, error) {
	return claude.ListClaudeConfigAgents(projectPath)
}

// GetClaudeConfigAgent retrieves a specific Claude config agent by scope and name
func (a *App) GetClaudeConfigAgent(scope, name, projectPath string) (*claude.ClaudeAgent, error) {
	return claude.GetClaudeAgent(scope, name, projectPath)
}

// SaveClaudeConfigAgent saves a Claude config agent to the appropriate location
func (a *App) SaveClaudeConfigAgent(agent *claude.ClaudeAgent, projectPath string) error {
	return claude.SaveClaudeAgent(agent, projectPath)
}

// DeleteClaudeConfigAgent deletes a Claude config agent
func (a *App) DeleteClaudeConfigAgent(scope, name, projectPath string) error {
	return claude.DeleteClaudeAgent(scope, name, projectPath)
}

// ===== Model Config Bindings =====

// GetAllModelConfigs retrieves all model configurations
func (a *App) GetAllModelConfigs() ([]*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return []*database.ModelConfig{}, nil
	}
	configs, err := a.modelRegistry.GetAllModels()
	if err != nil {
		return []*database.ModelConfig{}, err
	}
	if configs == nil {
		return []*database.ModelConfig{}, nil
	}
	return configs, nil
}

// GetEnabledModelConfigs retrieves all enabled model configurations
func (a *App) GetEnabledModelConfigs() ([]*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return []*database.ModelConfig{}, nil
	}
	configs, err := a.modelRegistry.GetEnabledModels()
	if err != nil {
		return []*database.ModelConfig{}, err
	}
	if configs == nil {
		return []*database.ModelConfig{}, nil
	}
	return configs, nil
}

// GetModelConfigsByProvider retrieves all model configurations for a specific provider
func (a *App) GetModelConfigsByProvider(providerID string) ([]*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return []*database.ModelConfig{}, nil
	}
	configs, err := a.modelRegistry.GetModelsByProvider(providerID)
	if err != nil {
		return []*database.ModelConfig{}, err
	}
	if configs == nil {
		return []*database.ModelConfig{}, nil
	}
	return configs, nil
}

// GetModelConfig retrieves a model configuration by ID
func (a *App) GetModelConfig(id string) (*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return nil, nil
	}
	return a.modelRegistry.GetModel(id)
}

// GetModelConfigByModelID retrieves a model configuration by model_id
func (a *App) GetModelConfigByModelID(modelID string) (*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return nil, nil
	}
	return a.modelRegistry.GetModelByModelID(modelID)
}

// GetDefaultModelConfig retrieves the default model configuration for a provider
func (a *App) GetDefaultModelConfig(providerID string) (*database.ModelConfig, error) {
	if a.modelRegistry == nil {
		return nil, nil
	}
	return a.modelRegistry.GetDefaultModel(providerID)
}

// CreateModelConfig creates a new user-defined model configuration
func (a *App) CreateModelConfig(config *database.ModelConfig) error {
	if a.modelRegistry == nil {
		return nil
	}
	return a.modelRegistry.CreateModel(config)
}

// UpdateModelConfig updates a user-defined model configuration
func (a *App) UpdateModelConfig(id string, config *database.ModelConfig) error {
	if a.modelRegistry == nil {
		return nil
	}
	return a.modelRegistry.UpdateModel(id, config)
}

// DeleteModelConfig deletes a user-defined model configuration
func (a *App) DeleteModelConfig(id string) error {
	if a.modelRegistry == nil {
		return nil
	}
	return a.modelRegistry.DeleteModel(id)
}

// SetModelConfigEnabled enables or disables a model configuration
func (a *App) SetModelConfigEnabled(id string, enabled bool) error {
	if a.modelRegistry == nil {
		return nil
	}
	return a.modelRegistry.SetModelEnabled(id, enabled)
}

// SetModelConfigDefault sets a model as the default for its provider
func (a *App) SetModelConfigDefault(id string) error {
	if a.modelRegistry == nil {
		return nil
	}
	return a.modelRegistry.SetDefaultModel(id)
}

// GetModelThinkingLevels retrieves the thinking levels for a model
func (a *App) GetModelThinkingLevels(modelID string) ([]database.ThinkingLevel, error) {
	if a.modelRegistry == nil {
		return []database.ThinkingLevel{}, nil
	}
	levels, err := a.modelRegistry.GetThinkingLevels(modelID)
	if err != nil {
		return []database.ThinkingLevel{}, err
	}
	if levels == nil {
		return []database.ThinkingLevel{}, nil
	}
	return levels, nil
}

// GetDefaultThinkingLevel retrieves the default thinking level for a model
func (a *App) GetDefaultThinkingLevel(modelID string) (*database.ThinkingLevel, error) {
	if a.modelRegistry == nil {
		return nil, nil
	}
	return a.modelRegistry.GetDefaultThinkingLevel(modelID)
}

// ===== Agent Run Bindings =====

// ExecuteAgent starts an agent run with the specified parameters
func (a *App) ExecuteAgent(agentID int64, projectPath, task, model string) (*database.AgentRun, error) {
	if a.dbManager == nil || a.claudeManager == nil {
		return nil, nil
	}

	// Get the agent
	agent, err := a.dbManager.GetAgent(agentID)
	if err != nil {
		return nil, err
	}

	// Create the agent run record
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

	// Build the prompt with system prompt + task
	prompt := agent.SystemPrompt
	if task != "" {
		prompt = prompt + "\n\n---\n\nTask: " + task
	}

	// Start the Claude session
	config := claude.SessionConfig{
		ProjectPath:   projectPath,
		Prompt:        prompt,
		Model:         model,
		ProviderApiID: agent.ProviderApiID,
	}

	sessionID, err := a.claudeManager.StartSession(config)
	if err != nil {
		// Update run status to failed
		a.dbManager.UpdateAgentRunStatus(runID, "failed", 0, nil, nil)
		return nil, err
	}

	// Update run with session info
	run.SessionID = sessionID
	run.Status = "running"
	now := run.CreatedAt
	run.ProcessStartedAt = &now

	// Get PID from session status if available
	if status := a.claudeManager.GetSession(sessionID); status != nil {
		run.PID = status.PID
	}

	err = a.dbManager.UpdateAgentRunStatus(runID, "running", run.PID, run.ProcessStartedAt, nil)
	if err != nil {
		return nil, err
	}

	return run, nil
}

// ListAgentRuns returns agent runs, optionally filtered by agent ID
func (a *App) ListAgentRuns(agentID int64, limit int) ([]*database.AgentRun, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	var agentIDPtr *int64
	if agentID > 0 {
		agentIDPtr = &agentID
	}
	if limit <= 0 {
		limit = 50 // Default limit
	}
	return a.dbManager.ListAgentRuns(agentIDPtr, limit)
}

// GetAgentRun retrieves an agent run by ID
func (a *App) GetAgentRun(id int64) (*database.AgentRun, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetAgentRun(id)
}

// GetAgentRunBySessionID retrieves an agent run by session ID
func (a *App) GetAgentRunBySessionID(sessionID string) (*database.AgentRun, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.GetAgentRunBySessionID(sessionID)
}

// ListRunningAgentRuns returns all currently running agent runs
func (a *App) ListRunningAgentRuns() ([]*database.AgentRun, error) {
	if a.dbManager == nil {
		return nil, nil
	}
	return a.dbManager.ListRunningAgentRuns()
}

// CancelAgentRun cancels a running agent
func (a *App) CancelAgentRun(runID int64) error {
	if a.dbManager == nil || a.claudeManager == nil {
		return nil
	}

	run, err := a.dbManager.GetAgentRun(runID)
	if err != nil {
		return err
	}

	// Cancel the Claude session if it exists
	if run.SessionID != "" {
		a.claudeManager.TerminateSession(run.SessionID)
	}

	// Update run status
	now := run.CreatedAt
	return a.dbManager.UpdateAgentRunStatus(runID, "cancelled", run.PID, run.ProcessStartedAt, &now)
}

// DeleteAgentRun deletes an agent run
func (a *App) DeleteAgentRun(id int64) error {
	if a.dbManager == nil {
		return nil
	}
	return a.dbManager.DeleteAgentRun(id)
}

// GetAgentRunOutput returns the output of an agent run's session
func (a *App) GetAgentRunOutput(runID int64) (string, error) {
	if a.dbManager == nil || a.claudeManager == nil {
		return "", nil
	}

	run, err := a.dbManager.GetAgentRun(runID)
	if err != nil {
		return "", err
	}

	if run.SessionID == "" {
		return "", nil
	}

	return a.claudeManager.GetSessionOutput(run.SessionID)
}

// ===== Hooks Bindings =====

// GetHooks returns all hooks configuration from ~/.claude/settings.json
func (a *App) GetHooks() (*claude.HooksConfig, error) {
	if a.config == nil {
		return nil, nil
	}
	return claude.GetHooks(a.config.ClaudeDir)
}

// SaveHooks saves the hooks configuration to ~/.claude/settings.json
func (a *App) SaveHooks(hooks *claude.HooksConfig) error {
	if a.config == nil {
		return nil
	}
	return claude.SaveHooks(a.config.ClaudeDir, hooks)
}

// GetHooksByType returns hooks for a specific type (PreToolUse, PostToolUse, Notification, Stop)
func (a *App) GetHooksByType(hookType string) ([]claude.HookMatcher, error) {
	if a.config == nil {
		return nil, nil
	}
	return claude.GetHooksByType(a.config.ClaudeDir, hookType)
}

// ===== Command Execution Bindings =====

// CommandResult represents the result of a command execution
type CommandResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

// ExecuteCommand executes a shell command synchronously and returns the output
// This version accepts a single shell command string (compatible with Electron/Tauri API)
func (a *App) ExecuteCommand(command string, cwd string) CommandResult {
	// Determine shell based on OS
	var shellCmd *exec.Cmd
	if goruntime.GOOS == "windows" {
		shellCmd = exec.Command("cmd", "/C", command)
	} else {
		shellCmd = exec.Command("sh", "-c", command)
	}

	if cwd != "" {
		shellCmd.Dir = cwd
	}

	var stdout, stderr bytes.Buffer
	shellCmd.Stdout = &stdout
	shellCmd.Stderr = &stderr

	err := shellCmd.Run()
	if err != nil {
		return CommandResult{
			Success: false,
			Output:  stdout.String(),
			Error:   stderr.String() + ": " + err.Error(),
		}
	}

	return CommandResult{
		Success: true,
		Output:  stdout.String(),
		Error:   stderr.String(),
	}
}

// ExecuteCommandWithArgs executes a command with arguments synchronously
func (a *App) ExecuteCommandWithArgs(command string, args []string, cwd string) (string, error) {
	// Use processManager to spawn and wait for the command
	key := "sync-" + command + "-" + strings.Join(args, "-")

	proc, err := a.processManager.Spawn(key, command, args, cwd, nil)
	if err != nil {
		return "", err
	}

	// Wait for process to complete
	proc.Wait()

	// For now, return empty output since we don't capture stdout/stderr in Process
	// This can be enhanced later if needed
	return "", nil
}

// ExecuteCommandAsync executes a command asynchronously and returns a process key
func (a *App) ExecuteCommandAsync(command string, args []string, cwd string) (string, error) {
	// Generate unique key for this async command
	key := "async-" + command + "-" + strings.Join(args, "-")

	_, err := a.processManager.Spawn(key, command, args, cwd, nil)
	if err != nil {
		return "", err
	}

	return key, nil
}

// OpenInTerminal opens a directory in the system terminal
func (a *App) OpenInTerminal(path string) error {
	// macOS: use 'open -a Terminal' command
	cmd := exec.Command("open", "-a", "Terminal", path)
	return cmd.Start()
}

// OpenInEditor opens a file in the system editor
func (a *App) OpenInEditor(path string) error {
	// macOS: try VS Code first, fallback to default editor
	// Try VS Code
	cmd := exec.Command("open", "-a", "Visual Studio Code", path)
	if err := cmd.Start(); err != nil {
		// Fallback to default editor
		cmd = exec.Command("open", "-e", path)
		return cmd.Start()
	}
	return nil
}

// OpenUrl opens a URL in the system browser
func (a *App) OpenUrl(url string) error {
	// macOS: use 'open' command
	cmd := exec.Command("open", url)
	return cmd.Start()
}

// ===== MCP Server Bindings =====

// ListMcpServers returns all configured MCP servers
func (a *App) ListMcpServers() ([]*mcp.MCPServer, error) {
	if a.mcpManager == nil {
		return []*mcp.MCPServer{}, nil
	}
	return a.mcpManager.ListMcpServers()
}

// GetMcpServer returns a specific MCP server configuration
func (a *App) GetMcpServer(name string) (*mcp.MCPServer, error) {
	if a.mcpManager == nil {
		return nil, nil
	}
	return a.mcpManager.GetMcpServer(name)
}

// SaveMcpServer saves or updates an MCP server configuration
func (a *App) SaveMcpServer(name string, config *mcp.MCPServerConfig) error {
	if a.mcpManager == nil {
		return nil
	}
	return a.mcpManager.SaveMcpServer(name, config)
}

// DeleteMcpServer removes an MCP server configuration
func (a *App) DeleteMcpServer(name string) error {
	if a.mcpManager == nil {
		return nil
	}
	return a.mcpManager.DeleteMcpServer(name)
}

// GetMcpServerStatus returns the runtime status of an MCP server
func (a *App) GetMcpServerStatus(name string) (*mcp.MCPServerStatus, error) {
	if a.mcpManager == nil {
		return nil, nil
	}
	return a.mcpManager.GetMcpServerStatus(name)
}

// ===== Project & Workspace Management Bindings =====

// scanRopcodeWorktrees scans the .ropcode directory for existing git worktrees
func (a *App) scanRopcodeWorktrees(projectPath string) ([]database.WorkspaceIndex, error) {
	ropcodeDir := filepath.Join(projectPath, ".ropcode")

	// Check if .ropcode directory exists
	if _, err := os.Stat(ropcodeDir); os.IsNotExist(err) {
		return []database.WorkspaceIndex{}, nil
	}

	// Read all entries in .ropcode directory
	entries, err := os.ReadDir(ropcodeDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read .ropcode directory: %w", err)
	}

	var workspaces []database.WorkspaceIndex

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		worktreePath := filepath.Join(ropcodeDir, entry.Name())

		// Validate: .git must be a file (not directory) for worktrees
		gitPath := filepath.Join(worktreePath, ".git")
		gitInfo, err := os.Stat(gitPath)
		if err != nil || gitInfo.IsDir() {
			continue
		}

		// Get branch name using git command
		branch := entry.Name()
		cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
		cmd.Dir = worktreePath
		if output, err := cmd.Output(); err == nil {
			branch = strings.TrimSpace(string(output))
		}

		workspace := database.WorkspaceIndex{
			Name:    entry.Name(),
			AddedAt: time.Now().Unix(),
			Providers: []database.ProviderInfo{
				{
					ID:         entry.Name(),
					ProviderID: "claude",
					Path:       worktreePath,
				},
			},
			LastProvider: "claude",
			Branch:       branch,
		}

		workspaces = append(workspaces, workspace)
	}

	return workspaces, nil
}

// AddProjectToIndex adds a project to the index
func (a *App) AddProjectToIndex(path string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	// Extract project name from path
	name := filepath.Base(path)
	now := time.Now().Unix()

	// Detect git support by trying to open as git repository
	_, gitErr := git.Open(path)
	hasGitSupport := gitErr == nil

	// Check if project already exists in database
	existingProject, err := a.dbManager.GetProjectIndex(name)
	if err == nil && existingProject != nil {
		// Project exists - scan and merge new worktrees
		existingNames := make(map[string]bool)
		for _, ws := range existingProject.Workspaces {
			existingNames[ws.Name] = true
		}

		scannedWorkspaces, _ := a.scanRopcodeWorktrees(path)
		for _, ws := range scannedWorkspaces {
			if !existingNames[ws.Name] {
				existingProject.Workspaces = append(existingProject.Workspaces, ws)
			}
		}

		existingProject.LastAccessed = now
		// Update git support status
		existingProject.HasGitSupport = &hasGitSupport
		return a.dbManager.SaveProjectIndex(existingProject)
	}

	// Scan .ropcode directory for existing worktrees
	workspaces, scanErr := a.scanRopcodeWorktrees(path)
	if scanErr != nil {
		workspaces = []database.WorkspaceIndex{}
	}

	project := &database.ProjectIndex{
		Name:         name,
		AddedAt:      now,
		LastAccessed: now,
		Available:    true,
		Providers: []database.ProviderInfo{
			{
				ID:         name,
				ProviderID: "claude",
				Path:       path,
			},
		},
		Workspaces:    workspaces,
		LastProvider:  "claude",
		HasGitSupport: &hasGitSupport,
	}

	return a.dbManager.SaveProjectIndex(project)
}

// RemoveProjectFromIndex removes a project from the index by ID (name)
func (a *App) RemoveProjectFromIndex(id string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.DeleteProjectIndex(id)
}

// UpdateProjectAccessTime updates the last accessed time for a project
func (a *App) UpdateProjectAccessTime(id string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	project, err := a.dbManager.GetProjectIndex(id)
	if err != nil {
		return err
	}

	project.LastAccessed = time.Now().Unix()
	return a.dbManager.SaveProjectIndex(project)
}

// CreateProject creates a new project directory structure
func (a *App) CreateProject(path string) error {
	// Ensure the directory exists
	if err := os.MkdirAll(path, 0755); err != nil {
		return err
	}

	// Add to index
	return a.AddProjectToIndex(path)
}

// GetProjectSessions returns session IDs for a project
func (a *App) GetProjectSessions(id string) ([]string, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database manager not initialized")
	}

	project, err := a.dbManager.GetProjectIndex(id)
	if err != nil {
		return nil, err
	}

	// Get the project path from providers
	var projectPath string
	for _, provider := range project.Providers {
		if provider.ProviderID == "claude" {
			projectPath = provider.Path
			break
		}
	}

	if projectPath == "" {
		return []string{}, nil
	}

	// Look for JSONL files in ~/.claude/projects/<encoded-path>/
	// For simplicity, return empty array for now
	// Full implementation would scan the Claude projects directory
	return []string{}, nil
}

// CreateWorkspace creates a new workspace (git worktree)
func (a *App) CreateWorkspace(parent string, branch string, name string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	// 1. Validate parent project path
	if _, err := os.Stat(parent); os.IsNotExist(err) {
		return fmt.Errorf("parent project path does not exist: %s", parent)
	}

	// Get parent project
	parentName := filepath.Base(parent)
	project, err := a.dbManager.GetProjectIndex(parentName)
	if err != nil {
		return err
	}

	// Generate workspace name if not provided
	if name == "" {
		name = branch
	}

	// 2. Create .ropcode directory if it doesn't exist
	ropcodeDir := filepath.Join(parent, ".ropcode")
	if err := os.MkdirAll(ropcodeDir, 0755); err != nil {
		return fmt.Errorf("failed to create .ropcode directory: %w", err)
	}

	// 3. Generate workspace path
	workspacePath := filepath.Join(ropcodeDir, name)

	// 4. Execute git worktree add
	// Use -B to allow branch reset if it exists
	// Syntax: git worktree add -B <branch> <path>
	cmd := exec.Command("git", "worktree", "add", "-B", branch, workspacePath)
	cmd.Dir = parent
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add worktree: %s - %w", string(output), err)
	}

	// 5. Create workspace index
	workspace := database.WorkspaceIndex{
		Name:    name,
		AddedAt: time.Now().Unix(),
		Providers: []database.ProviderInfo{
			{
				ID:         name,
				ProviderID: "claude",
				Path:       workspacePath,
			},
		},
		LastProvider: "claude",
		Branch:       branch,
	}

	// Add workspace to project
	project.Workspaces = append(project.Workspaces, workspace)

	return a.dbManager.SaveProjectIndex(project)
}

// RemoveWorkspace removes a workspace from the index
func (a *App) RemoveWorkspace(id string) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	// Find parent project containing this workspace
	projects, err := a.dbManager.GetAllProjectIndexes()
	if err != nil {
		return err
	}

	for _, project := range projects {
		for i, workspace := range project.Workspaces {
			if workspace.Name == id {
				// Remove workspace from slice
				project.Workspaces = append(project.Workspaces[:i], project.Workspaces[i+1:]...)
				return a.dbManager.SaveProjectIndex(project)
			}
		}
	}

	return nil
}

// UpdateProjectFields updates fields in a project
func (a *App) UpdateProjectFields(path string, updates map[string]interface{}) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	name := filepath.Base(path)
	project, err := a.dbManager.GetProjectIndex(name)
	if err != nil {
		return err
	}

	// Apply updates
	if desc, ok := updates["description"].(string); ok {
		project.Description = desc
	}
	if available, ok := updates["available"].(bool); ok {
		project.Available = available
	}
	if lastProvider, ok := updates["last_provider"].(string); ok {
		project.LastProvider = lastProvider
	}
	if projectType, ok := updates["project_type"].(string); ok {
		project.ProjectType = projectType
	}

	return a.dbManager.SaveProjectIndex(project)
}

// UpdateWorkspaceFields updates fields in a workspace
func (a *App) UpdateWorkspaceFields(path string, updates map[string]interface{}) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}

	// Find parent project and workspace
	projects, err := a.dbManager.GetAllProjectIndexes()
	if err != nil {
		return err
	}

	workspaceName := filepath.Base(path)
	for _, project := range projects {
		for i, workspace := range project.Workspaces {
			if workspace.Name == workspaceName {
				// Apply updates
				if branch, ok := updates["branch"].(string); ok {
					project.Workspaces[i].Branch = branch
				}
				if lastProvider, ok := updates["last_provider"].(string); ok {
					project.Workspaces[i].LastProvider = lastProvider
				}

				return a.dbManager.SaveProjectIndex(project)
			}
		}
	}

	return fmt.Errorf("workspace not found: %s", workspaceName)
}

// ===== Storage/Database Operations Bindings =====

// StorageListTables lists all tables in the database
func (a *App) StorageListTables() ([]string, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.ListTables()
}

// StorageReadTable reads table data with pagination
func (a *App) StorageReadTable(table string, page, pageSize int) (*database.TableData, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.ReadTable(table, page, pageSize)
}

// StorageInsertRow inserts a new row into the specified table
func (a *App) StorageInsertRow(table string, data map[string]interface{}) (int64, error) {
	if a.dbManager == nil {
		return 0, fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.InsertRow(table, data)
}

// StorageUpdateRow updates a row in the specified table by ID
func (a *App) StorageUpdateRow(table string, id int64, data map[string]interface{}) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.UpdateRow(table, id, data)
}

// StorageDeleteRow deletes a row from the specified table by ID
func (a *App) StorageDeleteRow(table string, id int64) error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.DeleteRow(table, id)
}

// StorageExecuteSql executes a read-only SQL query (SELECT only)
func (a *App) StorageExecuteSql(sql string) (*database.TableData, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.ExecuteSQL(sql)
}

// StorageResetDatabase resets the database by dropping all tables and reinitializing
func (a *App) StorageResetDatabase() error {
	if a.dbManager == nil {
		return fmt.Errorf("database manager not initialized")
	}
	return a.dbManager.ResetDatabase()
}

// ===== SSH Sync Bindings =====

// ListGlobalSshConnections returns all saved SSH connections
func (a *App) ListGlobalSshConnections() ([]ssh.SshConnection, error) {
	if a.sshManager == nil {
		return []ssh.SshConnection{}, nil
	}
	return a.sshManager.ListGlobalConnections()
}

// AddGlobalSshConnection adds a new global SSH connection
func (a *App) AddGlobalSshConnection(conn ssh.SshConnection) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.AddGlobalConnection(conn)
}

// DeleteGlobalSshConnection deletes a saved SSH connection by name
func (a *App) DeleteGlobalSshConnection(name string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.DeleteGlobalConnection(name)
}

// SyncFromSSH downloads files from remote SSH server to local
func (a *App) SyncFromSSH(localPath, remotePath, connectionName string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.SyncFromSSH(localPath, remotePath, connectionName)
}

// SyncToSSH uploads files from local to remote SSH server
func (a *App) SyncToSSH(localPath, remotePath, connectionName string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.SyncToSSH(localPath, remotePath, connectionName)
}

// StartAutoSync starts automatic file sync for a path
func (a *App) StartAutoSync(localPath, remotePath, connectionName string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.StartAutoSync(localPath, remotePath, connectionName)
}

// StopAutoSync stops automatic file sync for a path
func (a *App) StopAutoSync(localPath string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.StopAutoSync(localPath)
}

// PauseSshSync pauses an ongoing SSH sync operation
func (a *App) PauseSshSync(localPath string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.PauseSshSync(localPath)
}

// ResumeSshSync resumes a paused SSH sync operation
func (a *App) ResumeSshSync(localPath string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.ResumeSshSync(localPath)
}

// CancelSshSync cancels an ongoing SSH sync operation
func (a *App) CancelSshSync(localPath string) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.CancelSshSync(localPath)
}

// GetAutoSyncStatus returns the auto-sync status for a path
func (a *App) GetAutoSyncStatus(localPath string) (*ssh.AutoSyncStatus, error) {
	if a.sshManager == nil {
		return nil, fmt.Errorf("SSH manager not initialized")
	}
	return a.sshManager.GetAutoSyncStatus(localPath)
}

// ===== Plugin System Bindings =====

// ListInstalledPlugins returns all installed plugins
func (a *App) ListInstalledPlugins() ([]plugin.Plugin, error) {
	if a.pluginManager == nil {
		return []plugin.Plugin{}, nil
	}
	return a.pluginManager.ListInstalled()
}

// GetPluginDetails returns details for a specific plugin
func (a *App) GetPluginDetails(id string) (*plugin.Plugin, error) {
	if a.pluginManager == nil {
		return nil, fmt.Errorf("plugin manager not initialized")
	}
	return a.pluginManager.GetDetails(id)
}

// GetPluginContents returns all contents of a plugin (agents, commands, skills, hooks)
func (a *App) GetPluginContents(id string) (*plugin.PluginContents, error) {
	if a.pluginManager == nil {
		return nil, fmt.Errorf("plugin manager not initialized")
	}
	return a.pluginManager.GetContents(id)
}

// ListPluginAgents returns all agents from a specific plugin
func (a *App) ListPluginAgents(pluginID string) ([]plugin.PluginAgent, error) {
	if a.pluginManager == nil {
		return []plugin.PluginAgent{}, nil
	}
	return a.pluginManager.ListAgents(pluginID)
}

// ListPluginCommands returns all commands from a specific plugin
func (a *App) ListPluginCommands(pluginID string) ([]plugin.PluginCommand, error) {
	if a.pluginManager == nil {
		return []plugin.PluginCommand{}, nil
	}
	return a.pluginManager.ListCommands(pluginID)
}

// ListPluginSkills returns all skills from a specific plugin
func (a *App) ListPluginSkills(pluginID string) ([]plugin.PluginSkill, error) {
	if a.pluginManager == nil {
		return []plugin.PluginSkill{}, nil
	}
	return a.pluginManager.ListSkills(pluginID)
}

// ListPluginHooks returns all hooks from a specific plugin
func (a *App) ListPluginHooks(pluginID string) ([]plugin.PluginHook, error) {
	if a.pluginManager == nil {
		return []plugin.PluginHook{}, nil
	}
	return a.pluginManager.ListHooks(pluginID)
}

// GetPluginAgent returns a specific agent from a plugin
func (a *App) GetPluginAgent(pluginID, agentName string) (*plugin.PluginAgent, error) {
	if a.pluginManager == nil {
		return nil, fmt.Errorf("plugin manager not initialized")
	}
	return a.pluginManager.GetAgent(pluginID, agentName)
}

// GetPluginCommand returns a specific command from a plugin
func (a *App) GetPluginCommand(pluginID, commandName string) (*plugin.PluginCommand, error) {
	if a.pluginManager == nil {
		return nil, fmt.Errorf("plugin manager not initialized")
	}
	return a.pluginManager.GetCommand(pluginID, commandName)
}

// GetPluginSkill returns a specific skill from a plugin
func (a *App) GetPluginSkill(pluginID, skillName string) (*plugin.PluginSkill, error) {
	if a.pluginManager == nil {
		return nil, fmt.Errorf("plugin manager not initialized")
	}
	return a.pluginManager.GetSkill(pluginID, skillName)
}

// ===== Usage Stats Bindings =====

// ModelStat represents usage statistics for a model
type ModelStat struct {
	Model              string  `json:"model"`
	TotalTokens        int64   `json:"total_tokens"`
	TotalInputTokens   int64   `json:"total_input_tokens"`
	TotalOutputTokens  int64   `json:"total_output_tokens"`
	TotalCacheCreation int64   `json:"total_cache_creation_tokens"`
	TotalCacheRead     int64   `json:"total_cache_read_tokens"`
	SessionCount       int     `json:"session_count"`
	TotalCost          float64 `json:"total_cost"`
	InputTokens        int64   `json:"input_tokens"`
	OutputTokens       int64   `json:"output_tokens"`
	CacheCreationTokens int64  `json:"cache_creation_tokens"`
	CacheReadTokens    int64   `json:"cache_read_tokens"`
}

// DayStat represents daily usage statistics
type DayStat struct {
	Date        string   `json:"date"`
	TotalTokens int64    `json:"total_tokens"`
	ModelsUsed  []string `json:"models_used"`
	TotalCost   float64  `json:"total_cost"`
}

// ProjectStat represents usage statistics for a project
type ProjectStat struct {
	ProjectPath  string  `json:"project_path"`
	ProjectName  string  `json:"project_name"`
	TotalCost    float64 `json:"total_cost"`
	TotalTokens  int64   `json:"total_tokens"`
	SessionCount int     `json:"session_count"`
	LastUsed     string  `json:"last_used"`
}

// UsageStats represents overall usage statistics
type UsageStats struct {
	TotalTokens              int64         `json:"total_tokens"`
	TotalInputTokens         int64         `json:"total_input_tokens"`
	TotalOutputTokens        int64         `json:"total_output_tokens"`
	TotalSessions            int           `json:"total_sessions"`
	TotalCacheCreationTokens int64         `json:"total_cache_creation_tokens"`
	TotalCacheReadTokens     int64         `json:"total_cache_read_tokens"`
	TotalCost                float64       `json:"total_cost"`
	ByModel                  []ModelStat   `json:"by_model"`
	ByDay                    []DayStat     `json:"by_day"`
	ByDate                   []DayStat     `json:"by_date"`
	ByProject                []ProjectStat `json:"by_project"`
}

// calculateTokenCost calculates the cost based on model and token counts
// Prices are per million tokens (MTok)
func calculateTokenCost(model string, inputTokens, outputTokens, cacheCreation, cacheRead int64) float64 {
	// Default to Sonnet pricing
	inputPrice := 3.0   // $ per MTok
	outputPrice := 15.0 // $ per MTok
	cacheWritePrice := 3.75 // $ per MTok
	cacheReadPrice := 0.30  // $ per MTok

	// Adjust pricing based on model
	modelLower := strings.ToLower(model)
	if strings.Contains(modelLower, "opus") {
		inputPrice = 15.0
		outputPrice = 75.0
		cacheWritePrice = 18.75
		cacheReadPrice = 1.50
	} else if strings.Contains(modelLower, "haiku") {
		inputPrice = 0.25
		outputPrice = 1.25
		cacheWritePrice = 0.30
		cacheReadPrice = 0.03
	}

	// Calculate cost (divide by 1M to get per-token cost)
	cost := float64(inputTokens) * inputPrice / 1_000_000
	cost += float64(outputTokens) * outputPrice / 1_000_000
	cost += float64(cacheCreation) * cacheWritePrice / 1_000_000
	cost += float64(cacheRead) * cacheReadPrice / 1_000_000

	return cost
}

// GetUsageStats returns overall usage statistics
func (a *App) GetUsageStats() (*UsageStats, error) {
	// Get Claude home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	claudeDir := filepath.Join(homeDir, ".claude")

	// Create collector and collect stats
	collector := usage.NewCollector(claudeDir)
	overallStats, err := collector.CollectStats()
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage stats: %w", err)
	}

	// Track total cache tokens
	var totalCacheCreation, totalCacheRead int64
	var totalCost float64

	// Convert internal types to binding types
	byModel := make([]ModelStat, 0, len(overallStats.ByModel))
	for _, ms := range overallStats.ByModel {
		modelCost := calculateTokenCost(ms.Model, ms.TotalInputTokens, ms.TotalOutputTokens, ms.TotalCacheCreation, ms.TotalCacheRead)
		totalCost += modelCost
		totalCacheCreation += ms.TotalCacheCreation
		totalCacheRead += ms.TotalCacheRead

		byModel = append(byModel, ModelStat{
			Model:               ms.Model,
			TotalTokens:         ms.TotalTokens,
			TotalInputTokens:    ms.TotalInputTokens,
			TotalOutputTokens:   ms.TotalOutputTokens,
			TotalCacheCreation:  ms.TotalCacheCreation,
			TotalCacheRead:      ms.TotalCacheRead,
			SessionCount:        ms.SessionCount,
			TotalCost:           modelCost,
			InputTokens:         ms.TotalInputTokens,
			OutputTokens:        ms.TotalOutputTokens,
			CacheCreationTokens: ms.TotalCacheCreation,
			CacheReadTokens:     ms.TotalCacheRead,
		})
	}

	byDay := make([]DayStat, 0, len(overallStats.ByDay))
	for _, ds := range overallStats.ByDay {
		// Use cost from JSONL if available, otherwise estimate
		dayCost := ds.TotalCost
		if dayCost == 0 {
			dayCost = float64(ds.TotalTokens) * 9.0 / 1_000_000 // Average of input/output pricing
		}
		byDay = append(byDay, DayStat{
			Date:        ds.Date,
			TotalTokens: ds.TotalTokens,
			ModelsUsed:  ds.ModelsUsed,
			TotalCost:   dayCost,
		})
	}

	// Convert project stats
	byProject := make([]ProjectStat, 0, len(overallStats.ByProject))
	for _, ps := range overallStats.ByProject {
		byProject = append(byProject, ProjectStat{
			ProjectPath:  ps.ProjectPath,
			ProjectName:  ps.ProjectName,
			TotalCost:    ps.TotalCost,
			TotalTokens:  ps.TotalTokens,
			SessionCount: ps.SessionCount,
			LastUsed:     ps.LastUsed,
		})
	}

	// Use cost from JSONL if available
	if overallStats.TotalCost > 0 {
		totalCost = overallStats.TotalCost
	}

	return &UsageStats{
		TotalTokens:              overallStats.TotalTokens,
		TotalInputTokens:         overallStats.TotalInputTokens,
		TotalOutputTokens:        overallStats.TotalOutputTokens,
		TotalSessions:            overallStats.TotalSessions,
		TotalCacheCreationTokens: overallStats.TotalCacheCreation,
		TotalCacheReadTokens:     overallStats.TotalCacheRead,
		TotalCost:                totalCost,
		ByModel:                  byModel,
		ByDay:                    byDay,
		ByDate:                   byDay, // Alias for frontend compatibility
		ByProject:                byProject,
	}, nil
}

// GetUsageByDateRange returns usage statistics for a date range
func (a *App) GetUsageByDateRange(start, end string) (*UsageStats, error) {
	// Get Claude home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	claudeDir := filepath.Join(homeDir, ".claude")

	// Parse date strings (expected format: "2006-01-02")
	startDate, err := time.Parse("2006-01-02", start)
	if err != nil {
		return nil, fmt.Errorf("invalid start date format: %w", err)
	}
	endDate, err := time.Parse("2006-01-02", end)
	if err != nil {
		return nil, fmt.Errorf("invalid end date format: %w", err)
	}

	// Set end date to end of day
	endDate = endDate.Add(24*time.Hour - time.Second)

	// Create collector and collect stats
	collector := usage.NewCollector(claudeDir)
	overallStats, err := collector.CollectStatsByDateRange(startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage stats: %w", err)
	}

	// Track total cache tokens
	var totalCacheCreation, totalCacheRead int64
	var totalCost float64

	// Convert internal types to binding types
	byModel := make([]ModelStat, 0, len(overallStats.ByModel))
	for _, ms := range overallStats.ByModel {
		modelCost := calculateTokenCost(ms.Model, ms.TotalInputTokens, ms.TotalOutputTokens, ms.TotalCacheCreation, ms.TotalCacheRead)
		totalCost += modelCost
		totalCacheCreation += ms.TotalCacheCreation
		totalCacheRead += ms.TotalCacheRead

		byModel = append(byModel, ModelStat{
			Model:               ms.Model,
			TotalTokens:         ms.TotalTokens,
			TotalInputTokens:    ms.TotalInputTokens,
			TotalOutputTokens:   ms.TotalOutputTokens,
			TotalCacheCreation:  ms.TotalCacheCreation,
			TotalCacheRead:      ms.TotalCacheRead,
			SessionCount:        ms.SessionCount,
			TotalCost:           modelCost,
			InputTokens:         ms.TotalInputTokens,
			OutputTokens:        ms.TotalOutputTokens,
			CacheCreationTokens: ms.TotalCacheCreation,
			CacheReadTokens:     ms.TotalCacheRead,
		})
	}

	byDay := make([]DayStat, 0, len(overallStats.ByDay))
	for _, ds := range overallStats.ByDay {
		// Use cost from JSONL if available, otherwise estimate
		dayCost := ds.TotalCost
		if dayCost == 0 {
			dayCost = float64(ds.TotalTokens) * 9.0 / 1_000_000 // Average of input/output pricing
		}
		byDay = append(byDay, DayStat{
			Date:        ds.Date,
			TotalTokens: ds.TotalTokens,
			ModelsUsed:  ds.ModelsUsed,
			TotalCost:   dayCost,
		})
	}

	// Convert project stats
	byProject := make([]ProjectStat, 0, len(overallStats.ByProject))
	for _, ps := range overallStats.ByProject {
		byProject = append(byProject, ProjectStat{
			ProjectPath:  ps.ProjectPath,
			ProjectName:  ps.ProjectName,
			TotalCost:    ps.TotalCost,
			TotalTokens:  ps.TotalTokens,
			SessionCount: ps.SessionCount,
			LastUsed:     ps.LastUsed,
		})
	}

	// Use cost from JSONL if available
	if overallStats.TotalCost > 0 {
		totalCost = overallStats.TotalCost
	}

	return &UsageStats{
		TotalTokens:              overallStats.TotalTokens,
		TotalInputTokens:         overallStats.TotalInputTokens,
		TotalOutputTokens:        overallStats.TotalOutputTokens,
		TotalSessions:            overallStats.TotalSessions,
		TotalCacheCreationTokens: overallStats.TotalCacheCreation,
		TotalCacheReadTokens:     overallStats.TotalCacheRead,
		TotalCost:                totalCost,
		ByModel:                  byModel,
		ByDay:                    byDay,
		ByDate:                   byDay, // Alias for frontend compatibility
		ByProject:                byProject,
	}, nil
}

// GetSessionStats returns session statistics with optional filters
// Parameters: sessionId and projectId (both optional, can be empty strings)
func (a *App) GetSessionStats(sessionId string, projectId string) ([]interface{}, error) {
	// Get Claude home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	claudeDir := filepath.Join(homeDir, ".claude")

	// Create collector and collect session stats
	collector := usage.NewCollector(claudeDir)
	sessions, err := collector.CollectSessionStats()
	if err != nil {
		return nil, fmt.Errorf("failed to collect session stats: %w", err)
	}

	// Convert to interface{} slice
	result := make([]interface{}, 0, len(sessions))
	for _, session := range sessions {
		result = append(result, session)
	}

	return result, nil
}

// GetUsageDetails returns detailed usage information
func (a *App) GetUsageDetails(limit int) ([]interface{}, error) {
	// Get Claude home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	claudeDir := filepath.Join(homeDir, ".claude")

	// Create collector and collect usage details
	collector := usage.NewCollector(claudeDir)
	entries, err := collector.CollectUsageDetails(limit)
	if err != nil {
		return nil, fmt.Errorf("failed to collect usage details: %w", err)
	}

	// Convert to interface{} slice
	result := make([]interface{}, 0, len(entries))
	for _, entry := range entries {
		result = append(result, entry)
	}

	return result, nil
}

// ===== Claude Agents Bindings =====

// ClaudeAgentEntry represents a Claude agent as a FileEntry-compatible structure
type ClaudeAgentEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"is_directory"`
	Size        int64  `json:"size"`
	Extension   string `json:"extension,omitempty"`
	EntryType   string `json:"entry_type"`
	Icon        string `json:"icon,omitempty"`
	Color       string `json:"color,omitempty"`
}

// ListClaudeAgents returns all Claude agents from user, project, and plugin sources
func (a *App) ListClaudeAgents() ([]ClaudeAgentEntry, error) {
	var entries []ClaudeAgentEntry

	// Load user/project agents
	agents, err := claude.ListClaudeConfigAgents("")
	if err == nil {
		for _, agent := range agents {
			entries = append(entries, ClaudeAgentEntry{
				Name:        agent.Name,
				Path:        agent.FilePath,
				IsDirectory: false,
				Size:        0,
				Extension:   ".md",
				EntryType:   "agent",
				Icon:        "🤖",
				Color:       agent.Color,
			})
		}
	}

	// Load plugin agents
	homeDir, err := os.UserHomeDir()
	if err == nil {
		pluginManager := plugin.NewManager(filepath.Join(homeDir, ".claude"))
		plugins, err := pluginManager.ListInstalled()
		if err == nil {
			for _, p := range plugins {
				pluginAgents, err := pluginManager.ListAgents(p.ID)
				if err == nil {
					for _, pAgent := range pluginAgents {
						// Format: pluginName:agentName
						displayName := fmt.Sprintf("%s:%s", pAgent.PluginName, pAgent.Name)
						entries = append(entries, ClaudeAgentEntry{
							Name:        displayName,
							Path:        pAgent.FilePath,
							IsDirectory: false,
							Size:        0,
							Extension:   ".md",
							EntryType:   "agent",
							Icon:        "🔌",
							Color:       pAgent.Color,
						})
					}
				}
			}
		}
	}

	return entries, nil
}

// SearchClaudeAgents searches for Claude agents by query
func (a *App) SearchClaudeAgents(query string) ([]ClaudeAgentEntry, error) {
	queryLower := strings.ToLower(query)
	var results []ClaudeAgentEntry

	// Search user/project agents
	agents, err := claude.ListClaudeConfigAgents("")
	if err == nil {
		for _, agent := range agents {
			// Match against name or description
			if strings.Contains(strings.ToLower(agent.Name), queryLower) ||
				strings.Contains(strings.ToLower(agent.Description), queryLower) {
				results = append(results, ClaudeAgentEntry{
					Name:        agent.Name,
					Path:        agent.FilePath,
					IsDirectory: false,
					Size:        0,
					Extension:   ".md",
					EntryType:   "agent",
					Icon:        "🤖",
					Color:       agent.Color,
				})
			}
		}
	}

	// Search plugin agents
	homeDir, err := os.UserHomeDir()
	if err == nil {
		pluginManager := plugin.NewManager(filepath.Join(homeDir, ".claude"))
		plugins, err := pluginManager.ListInstalled()
		if err == nil {
			for _, p := range plugins {
				pluginAgents, err := pluginManager.ListAgents(p.ID)
				if err == nil {
					for _, pAgent := range pluginAgents {
						displayName := fmt.Sprintf("%s:%s", pAgent.PluginName, pAgent.Name)
						// Match against name, plugin name, or description
						if strings.Contains(strings.ToLower(pAgent.Name), queryLower) ||
							strings.Contains(strings.ToLower(pAgent.PluginName), queryLower) ||
							strings.Contains(strings.ToLower(pAgent.Description), queryLower) ||
							strings.Contains(strings.ToLower(displayName), queryLower) {
							results = append(results, ClaudeAgentEntry{
								Name:        displayName,
								Path:        pAgent.FilePath,
								IsDirectory: false,
								Size:        0,
								Extension:   ".md",
								EntryType:   "agent",
								Icon:        "🔌",
								Color:       pAgent.Color,
							})
						}
					}
				}
			}
		}
	}

	return results, nil
}

// ===== GitHub Agents Bindings =====

// FetchGitHubAgents fetches available agents from GitHub
func (a *App) FetchGitHubAgents() ([]interface{}, error) {
	agents, err := github.FetchAgents(github.DefaultAgentsURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch GitHub agents: %w", err)
	}

	// Convert to []interface{} for JSON serialization
	// Fields match frontend GitHubAgentFile interface
	result := make([]interface{}, len(agents))
	for i, agent := range agents {
		result[i] = map[string]interface{}{
			"name":         agent.Name,
			"path":         agent.Path,
			"download_url": agent.DownloadURL,
			"size":         agent.Size,
			"sha":          agent.SHA,
		}
	}

	return result, nil
}

// FetchGitHubAgentContent fetches the content of a GitHub agent
func (a *App) FetchGitHubAgentContent(url string) (interface{}, error) {
	exportFile, err := github.FetchAgentExportFile(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agent content: %w", err)
	}

	// Return as map matching frontend AgentExport interface
	return map[string]interface{}{
		"version":     exportFile.Version,
		"exported_at": exportFile.ExportedAt,
		"agent": map[string]interface{}{
			"name":          exportFile.Agent.Name,
			"icon":          exportFile.Agent.Icon,
			"model":         exportFile.Agent.Model,
			"system_prompt": exportFile.Agent.SystemPrompt,
			"default_task":  exportFile.Agent.DefaultTask,
		},
	}, nil
}

// ImportAgentFromGitHub imports an agent from GitHub
func (a *App) ImportAgentFromGitHub(url string) (*database.Agent, error) {
	// Fetch agent content from GitHub
	agentContent, err := github.FetchAgentContent(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agent from GitHub: %w", err)
	}

	// Create database agent from GitHub content
	agent := &database.Agent{
		Name:         agentContent.Name,
		Icon:         agentContent.Icon,
		SystemPrompt: agentContent.SystemPrompt,
		DefaultTask:  agentContent.DefaultTask,
		Model:        agentContent.Model,
	}

	// Save to database
	id, err := a.dbManager.CreateAgent(agent)
	if err != nil {
		return nil, fmt.Errorf("failed to save agent to database: %w", err)
	}

	agent.ID = id
	return agent, nil
}

// ===== Misc Operations Bindings =====

// OpenNewSession opens a new Claude session
func (a *App) OpenNewSession(path string) (string, error) {
	// Generate a new session ID using UUID
	sessionID := uuid.New().String()

	// Session creation is handled by ExecuteClaudeCode when it's actually started
	// This just generates and returns a unique session ID
	return sessionID, nil
}

// ClaudeVersionInfo contains version information
type ClaudeVersionInfo struct {
	IsInstalled bool   `json:"is_installed"`
	Version     string `json:"version,omitempty"`
	Output      string `json:"output"`
}

// CheckClaudeVersion checks the installed Claude version
func (a *App) CheckClaudeVersion() (*ClaudeVersionInfo, error) {
	// Try to run claude --version
	cmd := exec.Command("claude", "--version")
	output, err := cmd.CombinedOutput()

	if err != nil {
		return &ClaudeVersionInfo{
			IsInstalled: false,
			Output:      string(output),
		}, nil
	}

	version := strings.TrimSpace(string(output))
	return &ClaudeVersionInfo{
		IsInstalled: true,
		Version:     version,
		Output:      version,
	}, nil
}

// ClaudeInstallation represents a Claude installation
type ClaudeInstallation struct {
	Path             string `json:"path"`
	Version          string `json:"version,omitempty"`
	Source           string `json:"source"`
	InstallationType string `json:"installation_type"`
}

// ListClaudeInstallations lists all Claude installations found on the system
func (a *App) ListClaudeInstallations() ([]ClaudeInstallation, error) {
	installations := []ClaudeInstallation{}
	seenPaths := make(map[string]bool) // Avoid duplicates

	// Try to find claude in PATH
	claudePath, err := exec.LookPath("claude")
	if err == nil {
		// Try to get version
		cmd := exec.Command(claudePath, "--version")
		output, _ := cmd.CombinedOutput()
		version := strings.TrimSpace(string(output))

		installations = append(installations, ClaudeInstallation{
			Path:             claudePath,
			Version:          version,
			Source:           "system",
			InstallationType: "System",
		})
		seenPaths[claudePath] = true
	}

	// Homebrew installations (macOS/Linux)
	homebrewPaths := []string{
		"/opt/homebrew/bin/claude",                  // Apple Silicon
		"/usr/local/bin/claude",                     // Intel Mac
		"/home/linuxbrew/.linuxbrew/bin/claude",     // Linux Homebrew
	}
	for _, path := range homebrewPaths {
		if _, seen := seenPaths[path]; seen {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			cmd := exec.Command(path, "--version")
			output, _ := cmd.CombinedOutput()
			version := strings.TrimSpace(string(output))

			installations = append(installations, ClaudeInstallation{
				Path:             path,
				Version:          version,
				Source:           "homebrew",
				InstallationType: "Homebrew",
			})
			seenPaths[path] = true
		}
	}

	// npm global installations
	homeDir, err := os.UserHomeDir()
	if err == nil {
		npmPaths := []string{
			filepath.Join(homeDir, ".npm", "bin", "claude"),
			filepath.Join(homeDir, ".npm-global", "bin", "claude"),
			filepath.Join(homeDir, ".local", "share", "npm", "bin", "claude"),
		}
		for _, path := range npmPaths {
			if _, seen := seenPaths[path]; seen {
				continue
			}
			if _, err := os.Stat(path); err == nil {
				cmd := exec.Command(path, "--version")
				output, _ := cmd.CombinedOutput()
				version := strings.TrimSpace(string(output))

				installations = append(installations, ClaudeInstallation{
					Path:             path,
					Version:          version,
					Source:           "npm-global",
					InstallationType: "npm Global",
				})
				seenPaths[path] = true
			}
		}

		// NVM installations
		nvmDir := filepath.Join(homeDir, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					path := filepath.Join(nvmDir, entry.Name(), "bin", "claude")
					if _, seen := seenPaths[path]; seen {
						continue
					}
					if _, err := os.Stat(path); err == nil {
						cmd := exec.Command(path, "--version")
						output, _ := cmd.CombinedOutput()
						version := strings.TrimSpace(string(output))

						installations = append(installations, ClaudeInstallation{
							Path:             path,
							Version:          version,
							Source:           "nvm",
							InstallationType: "NVM Node " + entry.Name(),
						})
						seenPaths[path] = true
					}
				}
			}
		}

		// Check for custom paths in ~/.clauderc
		claudeRcPath := filepath.Join(homeDir, ".clauderc")
		if data, err := os.ReadFile(claudeRcPath); err == nil {
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				// Look for CLAUDE_PATH or similar
				if strings.HasPrefix(line, "CLAUDE_PATH=") {
					path := strings.TrimPrefix(line, "CLAUDE_PATH=")
					path = strings.Trim(path, "\"'")
					if _, seen := seenPaths[path]; seen {
						continue
					}
					if _, err := os.Stat(path); err == nil {
						cmd := exec.Command(path, "--version")
						output, _ := cmd.CombinedOutput()
						version := strings.TrimSpace(string(output))

						installations = append(installations, ClaudeInstallation{
							Path:             path,
							Version:          version,
							Source:           "custom",
							InstallationType: "Custom (~/.clauderc)",
						})
						seenPaths[path] = true
					}
				}
			}
		}
	}

	// npx (local node_modules)
	// Note: npx doesn't have a fixed path, but we can check if it's available
	cmd := exec.Command("npx", "claude", "--version")
	if output, err := cmd.CombinedOutput(); err == nil {
		version := strings.TrimSpace(string(output))
		path := "npx claude"
		if _, seen := seenPaths[path]; !seen {
			installations = append(installations, ClaudeInstallation{
				Path:             path,
				Version:          version,
				Source:           "npx",
				InstallationType: "npx (local)",
			})
		}
	}

	return installations, nil
}

// CleanupFinishedProcesses cleans up finished processes and returns their keys
func (a *App) CleanupFinishedProcesses() ([]string, error) {
	if a.processManager == nil {
		return []string{}, nil
	}

	// Get all processes
	allProcesses := a.processManager.List()
	cleaned := []string{}

	// Check each process and cleanup if not alive
	for _, key := range allProcesses {
		if !a.processManager.IsAlive(key) {
			cleaned = append(cleaned, key)
		}
	}

	return cleaned, nil
}

// SavePastedImage saves a pasted image from base64 data
func (a *App) SavePastedImage(base64Data, filename string) (string, error) {
	// Get the home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}

	// Create the temp-images directory path
	tempImagesDir := filepath.Join(homeDir, ".ropcode", "temp-images")

	// Ensure the directory exists with proper permissions
	if err := os.MkdirAll(tempImagesDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create temp-images directory: %w", err)
	}

	// If filename is empty, generate a unique filename
	if filename == "" {
		// Use timestamp + UUID for uniqueness
		timestamp := time.Now().Format("20060102-150405")
		uniqueID := uuid.New().String()[:8]
		filename = fmt.Sprintf("pasted-%s-%s.png", timestamp, uniqueID)
	}

	// Remove data URL prefix if present (e.g., "data:image/png;base64,")
	if idx := strings.Index(base64Data, ","); idx != -1 {
		base64Data = base64Data[idx+1:]
	}

	// Decode base64 data
	imageData, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 data: %w", err)
	}

	// Construct full file path
	filePath := filepath.Join(tempImagesDir, filename)

	// Write the image data to file with proper permissions
	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", fmt.Errorf("failed to write image file: %w", err)
	}

	return filePath, nil
}


// OpenInExternalApp opens a file or path in an external application
func (a *App) OpenInExternalApp(appType, path string) error {
	switch appType {
	case "pycharm", "idea", "clion", "android-studio", "webstorm", "goland":
		// JetBrains IDEs: search for app in /Applications and ~/Applications
		// Support version suffixes like "PyCharm 2024.3.app"
		homeDir, _ := os.UserHomeDir()
		searchDirs := []string{"/Applications", filepath.Join(homeDir, "Applications")}

		appPatterns := map[string]string{
			"pycharm":        "PyCharm",
			"idea":           "IntelliJ IDEA",
			"clion":          "CLion",
			"android-studio": "Android Studio",
			"webstorm":       "WebStorm",
			"goland":         "GoLand",
		}

		pattern := appPatterns[appType]
		for _, dir := range searchDirs {
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			for _, entry := range entries {
				name := entry.Name()
				if strings.HasPrefix(name, pattern) && strings.HasSuffix(name, ".app") {
					fullPath := filepath.Join(dir, name)
					// Use open -na <app> --args <path>
					cmd := exec.Command("open", "-na", fullPath, "--args", path)
					return cmd.Start()
				}
			}
		}
		return fmt.Errorf("%s is not installed or not found in /Applications or ~/Applications", pattern)

	case "sublime":
		// Sublime Text: use bundle identifier
		// Try Sublime Text 4 first
		cmd := exec.Command("open", "-b", "com.sublimetext.4", path)
		if err := cmd.Start(); err == nil {
			return nil
		}
		// Fall back to Sublime Text 3
		cmd = exec.Command("open", "-b", "com.sublimetext.3", path)
		return cmd.Start()

	case "iterm":
		// iTerm: use AppleScript to open new tab and cd to directory
		script := fmt.Sprintf(`tell application "iTerm"
    activate
    try
        tell current window
            create tab with default profile
            tell current session
                write text "cd '%s'"
            end tell
        end tell
    on error
        create window with default profile
        tell current session of current window
            write text "cd '%s'"
        end tell
    end try
end tell`, path, path)
		cmd := exec.Command("osascript", "-e", script)
		return cmd.Start()

	case "finder":
		// Finder: just use 'open <path>'
		cmd := exec.Command("open", path)
		return cmd.Start()

	case "terminal":
		// Terminal: use AppleScript
		script := fmt.Sprintf(`tell application "Terminal"
    activate
    do script "cd '%s'"
end tell`, path)
		cmd := exec.Command("osascript", "-e", script)
		return cmd.Start()

	case "vscode":
		// VS Code: use bundle identifier
		cmd := exec.Command("open", "-b", "com.microsoft.VSCode", path)
		return cmd.Start()

	case "cursor":
		// Cursor: use bundle identifier
		cmd := exec.Command("open", "-b", "com.todesktop.230313mzl4w4u92", path)
		return cmd.Start()

	default:
		// Unknown app type, try using it as app name directly
		cmd := exec.Command("open", "-a", appType, path)
		return cmd.Start()
	}
}

// IsPtySessionAlive checks if a PTY session is alive
func (a *App) IsPtySessionAlive(id string) (bool, error) {
	if a.ptyManager == nil {
		return false, nil
	}

	// Check if session exists in the list
	sessions := a.ptyManager.ListSessions()
	for _, sessionID := range sessions {
		if sessionID == id {
			return true, nil
		}
	}

	return false, nil
}

// KillCommand kills a command by ID
func (a *App) KillCommand(id string) error {
	if a.processManager == nil {
		return fmt.Errorf("process manager not initialized")
	}

	return a.processManager.Kill(id)
}

// ===== Workspace Protection Bindings =====

// GetWorkspaceProtectionEnabled checks if workspace protection is enabled for a path
func (a *App) GetWorkspaceProtectionEnabled(path string) (bool, error) {
	if a.dbManager == nil {
		return true, nil // Default to enabled for safety
	}

	// Try to get the setting
	value, err := a.dbManager.GetSetting("workspace_protection_" + path)
	if err != nil {
		// If setting doesn't exist, default to enabled
		return true, nil
	}

	return value == "true", nil
}

// SetWorkspaceProtectionEnabled sets workspace protection for a path
func (a *App) SetWorkspaceProtectionEnabled(path string, enabled bool) error {
	if a.dbManager == nil {
		return nil
	}

	value := "false"
	if enabled {
		value = "true"
	}

	return a.dbManager.SaveSetting("workspace_protection_"+path, value)
}

// ===== MCP Advanced Operations Bindings =====

// MCPAddResult represents the result of adding an MCP server
type MCPAddResult struct {
	Name    string `json:"name"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// McpAdd adds a new MCP server configuration
func (a *App) McpAdd(name, command string, args []string, env map[string]string, scope string) (*MCPAddResult, error) {
	if a.mcpManager == nil {
		return &MCPAddResult{Name: name, Success: false, Message: "MCP manager not initialized"}, nil
	}

	config := &mcp.MCPServerConfig{
		Command: command,
		Args:    args,
		Env:     env,
	}

	err := a.mcpManager.SaveMcpServer(name, config)
	if err != nil {
		return &MCPAddResult{Name: name, Success: false, Message: err.Error()}, nil
	}

	return &MCPAddResult{Name: name, Success: true, Message: "MCP server added successfully"}, nil
}

// McpAddJson adds a new MCP server from JSON configuration
func (a *App) McpAddJson(name string, configJson string) (*MCPAddResult, error) {
	if a.mcpManager == nil {
		return &MCPAddResult{Name: name, Success: false, Message: "MCP manager not initialized"}, nil
	}

	// Parse the JSON config
	var config mcp.MCPServerConfig
	if err := json.Unmarshal([]byte(configJson), &config); err != nil {
		return &MCPAddResult{Name: name, Success: false, Message: "Invalid JSON: " + err.Error()}, nil
	}

	err := a.mcpManager.SaveMcpServer(name, &config)
	if err != nil {
		return &MCPAddResult{Name: name, Success: false, Message: err.Error()}, nil
	}

	return &MCPAddResult{Name: name, Success: true, Message: "MCP server added from JSON"}, nil
}

// MCPImportResult represents the result of importing MCP servers
type MCPImportResult struct {
	Success       bool     `json:"success"`
	ImportedCount int      `json:"imported_count"`
	FailedCount   int      `json:"failed_count"`
	Messages      []string `json:"messages"`
}

// McpAddFromClaudeDesktop imports MCP servers from Claude Desktop config
func (a *App) McpAddFromClaudeDesktop(scope string) (*MCPImportResult, error) {
	result := &MCPImportResult{
		Success:  true,
		Messages: []string{},
	}

	// Claude Desktop config path (macOS)
	homeDir, err := os.UserHomeDir()
	if err != nil {
		result.Success = false
		result.Messages = append(result.Messages, "Failed to get home directory: "+err.Error())
		return result, nil
	}

	// Claude Desktop config location on macOS
	configPath := filepath.Join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")

	// Check if file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		result.Success = false
		result.Messages = append(result.Messages, "Claude Desktop config not found at: "+configPath)
		return result, nil
	}

	// Read and parse config
	data, err := os.ReadFile(configPath)
	if err != nil {
		result.Success = false
		result.Messages = append(result.Messages, "Failed to read config: "+err.Error())
		return result, nil
	}

	var desktopConfig struct {
		McpServers map[string]struct {
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}

	if err := json.Unmarshal(data, &desktopConfig); err != nil {
		result.Success = false
		result.Messages = append(result.Messages, "Failed to parse config: "+err.Error())
		return result, nil
	}

	// Import each server
	for name, serverConfig := range desktopConfig.McpServers {
		config := &mcp.MCPServerConfig{
			Command: serverConfig.Command,
			Args:    serverConfig.Args,
			Env:     serverConfig.Env,
		}

		if err := a.mcpManager.SaveMcpServer(name, config); err != nil {
			result.FailedCount++
			result.Messages = append(result.Messages, fmt.Sprintf("Failed to import '%s': %s", name, err.Error()))
		} else {
			result.ImportedCount++
			result.Messages = append(result.Messages, fmt.Sprintf("Imported '%s'", name))
		}
	}

	return result, nil
}

// McpServe starts the MCP server (placeholder - actual implementation depends on MCP protocol)
func (a *App) McpServe() (string, error) {
	// This is a placeholder - MCP serve typically starts a server process
	return "MCP serve functionality not implemented", nil
}

// McpTestConnection tests connection to an MCP server
func (a *App) McpTestConnection(name string) (string, error) {
	if a.mcpManager == nil {
		return "", fmt.Errorf("MCP manager not initialized")
	}

	server, err := a.mcpManager.GetMcpServer(name)
	if err != nil {
		return "", err
	}

	// Try to execute the command to test if it's valid
	if server.Command == "" {
		return "Server has no command configured", nil
	}

	// Test if the command exists
	_, err = exec.LookPath(server.Command)
	if err != nil {
		return fmt.Sprintf("Command not found: %s", server.Command), nil
	}

	return fmt.Sprintf("Command '%s' is available", server.Command), nil
}

// McpResetProjectChoices resets MCP project choices
func (a *App) McpResetProjectChoices() (string, error) {
	// This clears any cached project-specific MCP choices
	// For now, return success as we don't have project-specific caching
	return "Project choices reset", nil
}

// MCPProjectConfig represents project-level MCP configuration
type MCPProjectConfig struct {
	Servers map[string]mcp.MCPServerConfig `json:"servers"`
}

// McpReadProjectConfig reads project-level MCP configuration
func (a *App) McpReadProjectConfig(projectPath string) (*MCPProjectConfig, error) {
	configPath := filepath.Join(projectPath, ".claude", "mcp.json")

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &MCPProjectConfig{Servers: make(map[string]mcp.MCPServerConfig)}, nil
		}
		return nil, err
	}

	var config MCPProjectConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	if config.Servers == nil {
		config.Servers = make(map[string]mcp.MCPServerConfig)
	}

	return &config, nil
}

// McpSaveProjectConfig saves project-level MCP configuration
func (a *App) McpSaveProjectConfig(projectPath string, config *MCPProjectConfig) (string, error) {
	configDir := filepath.Join(projectPath, ".claude")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", err
	}

	configPath := filepath.Join(configDir, "mcp.json")

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", err
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return "", err
	}

	return configPath, nil
}

// ===== Actions Management Bindings =====

// Action represents an action configuration
type Action struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Command     string `json:"command"`
	Icon        string `json:"icon,omitempty"`
	Scope       string `json:"scope"` // "global", "project", "workspace"
}

// ActionsResult represents the combined actions from all scopes
type ActionsResult struct {
	GlobalActions    []Action `json:"global_actions"`
	ProjectActions   []Action `json:"project_actions"`
	WorkspaceActions []Action `json:"workspace_actions"`
}

// GetActions returns all actions from global, project, and workspace scopes
func (a *App) GetActions(projectPath, workspacePath string) (*ActionsResult, error) {
	result := &ActionsResult{
		GlobalActions:    []Action{},
		ProjectActions:   []Action{},
		WorkspaceActions: []Action{},
	}

	// Get home directory for global actions
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return result, nil
	}

	// Load global actions from ~/.claude/actions.json
	globalPath := filepath.Join(homeDir, ".claude", "actions.json")
	if globalActions, err := loadActionsFromFile(globalPath, "global"); err == nil {
		result.GlobalActions = globalActions
	}

	// Load project actions from <project>/.claude/actions.json
	if projectPath != "" {
		projectActionsPath := filepath.Join(projectPath, ".claude", "actions.json")
		if projectActions, err := loadActionsFromFile(projectActionsPath, "project"); err == nil {
			result.ProjectActions = projectActions
		}
	}

	// Load workspace actions from <workspace>/.claude/actions.json
	if workspacePath != "" {
		workspaceActionsPath := filepath.Join(workspacePath, ".claude", "actions.json")
		if workspaceActions, err := loadActionsFromFile(workspaceActionsPath, "workspace"); err == nil {
			result.WorkspaceActions = workspaceActions
		}
	}

	return result, nil
}

// loadActionsFromFile loads actions from a JSON file
func loadActionsFromFile(path, scope string) ([]Action, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var actions []Action
	if err := json.Unmarshal(data, &actions); err != nil {
		return nil, err
	}

	// Set scope for each action
	for i := range actions {
		actions[i].Scope = scope
	}

	return actions, nil
}

// saveActionsToFile saves actions to a JSON file
func saveActionsToFile(path string, actions []Action) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(actions, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// UpdateProjectActions updates project-level actions
func (a *App) UpdateProjectActions(projectPath string, actions []Action) error {
	if projectPath == "" {
		return fmt.Errorf("project path is required")
	}

	actionsPath := filepath.Join(projectPath, ".claude", "actions.json")
	return saveActionsToFile(actionsPath, actions)
}

// UpdateWorkspaceActions updates workspace-level actions
func (a *App) UpdateWorkspaceActions(workspacePath string, actions []Action) error {
	if workspacePath == "" {
		return fmt.Errorf("workspace path is required")
	}

	actionsPath := filepath.Join(workspacePath, ".claude", "actions.json")
	return saveActionsToFile(actionsPath, actions)
}

// GetGlobalActions returns global actions
func (a *App) GetGlobalActions() ([]Action, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return []Action{}, nil
	}

	globalPath := filepath.Join(homeDir, ".claude", "actions.json")
	actions, err := loadActionsFromFile(globalPath, "global")
	if err != nil {
		return []Action{}, nil
	}

	return actions, nil
}

// UpdateGlobalActions updates global actions
func (a *App) UpdateGlobalActions(actions []Action) error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	globalPath := filepath.Join(homeDir, ".claude", "actions.json")
	return saveActionsToFile(globalPath, actions)
}

// ===== Skills Management Bindings =====

// Skill represents a skill configuration
type Skill struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	FullName     string   `json:"full_name"`
	Scope        string   `json:"scope"` // "plugin", "user", or "project"
	Content      string   `json:"content"`
	Description  *string  `json:"description,omitempty"`
	FilePath     string   `json:"path"`
	PluginID     *string  `json:"plugin_id,omitempty"`
	PluginName   *string  `json:"plugin_name,omitempty"`
	AllowedTools []string `json:"allowed_tools"`
}

// SkillFrontmatter represents parsed frontmatter from a skill file
type SkillFrontmatter struct {
	Name         string `yaml:"name"`
	Description  string `yaml:"description"`
	AllowedTools string `yaml:"allowed-tools"`
}

// SkillsList returns all skills from plugin, user, and project scopes
func (a *App) SkillsList(projectPath string) ([]Skill, error) {
	var skills []Skill

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return skills, nil
	}

	// Load plugin skills first
	pluginSkills := loadPluginSkills(homeDir)
	skills = append(skills, pluginSkills...)

	// Load user skills from ~/.claude/skills/
	userSkillsDir := filepath.Join(homeDir, ".claude", "skills")
	userSkills := loadSkillsFromDirectory(userSkillsDir, "user", nil, nil)
	skills = append(skills, userSkills...)

	// Load project skills from <project>/.claude/skills/
	if projectPath != "" {
		projectSkillsDir := filepath.Join(projectPath, ".claude", "skills")
		projectSkills := loadSkillsFromDirectory(projectSkillsDir, "project", nil, nil)
		skills = append(skills, projectSkills...)
	}

	// Sort: project first, then user, then plugin
	sort.Slice(skills, func(i, j int) bool {
		scopeOrder := func(s string) int {
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
		if scopeOrder(skills[i].Scope) != scopeOrder(skills[j].Scope) {
			return scopeOrder(skills[i].Scope) < scopeOrder(skills[j].Scope)
		}
		return skills[i].Name < skills[j].Name
	})

	return skills, nil
}

// loadPluginSkills loads skills from all installed plugins
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

		// Load skills from {pluginPath}/skills/
		skillsDir := filepath.Join(pluginPath, "skills")
		pluginSkills := loadSkillsFromDirectory(skillsDir, "plugin", &pluginID, &pluginName)
		skills = append(skills, pluginSkills...)
	}

	return skills
}

// loadSkillsFromDirectory loads skills from a directory
func loadSkillsFromDirectory(dir, scope string, pluginID, pluginName *string) []Skill {
	var skills []Skill

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return skills
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return skills
	}

	for _, entry := range entries {
		// Skip hidden files/directories
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		entryPath := filepath.Join(dir, entry.Name())

		if entry.IsDir() {
			// Directory-based skill (with SKILL.md)
			if skill := loadSkillFromDirectory(entryPath, scope, pluginID, pluginName); skill != nil {
				skills = append(skills, *skill)
			}
		} else if strings.HasSuffix(entry.Name(), ".md") {
			// File-based skill
			if skill := loadSkillFromFile(entryPath, scope, pluginID, pluginName); skill != nil {
				skills = append(skills, *skill)
			}
		}
	}

	return skills
}

// loadSkillFromDirectory loads a skill from a directory containing SKILL.md
func loadSkillFromDirectory(dirPath, scope string, pluginID, pluginName *string) *Skill {
	skillFile := filepath.Join(dirPath, "SKILL.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		return nil
	}

	content, err := os.ReadFile(skillFile)
	if err != nil {
		return nil
	}

	frontmatter, body := parseSkillFrontmatter(string(content))

	name := frontmatter.Name
	if name == "" {
		name = filepath.Base(dirPath)
	}

	var description *string
	if frontmatter.Description != "" {
		description = &frontmatter.Description
	}

	allowedTools := []string{}
	if frontmatter.AllowedTools != "" {
		for _, tool := range strings.Split(frontmatter.AllowedTools, ",") {
			allowedTools = append(allowedTools, strings.TrimSpace(tool))
		}
	}

	// Build full name based on scope
	var fullName string
	switch scope {
	case "plugin":
		if pluginName != nil {
			fullName = fmt.Sprintf(":%s:%s", *pluginName, name)
		} else {
			fullName = fmt.Sprintf(":%s", name)
		}
	default:
		fullName = fmt.Sprintf(":%s", name)
	}

	// Build unique ID
	var id string
	switch scope {
	case "plugin":
		if pluginID != nil {
			sanitizedID := strings.ReplaceAll(strings.ReplaceAll(*pluginID, "@", "-"), "/", "-")
			id = fmt.Sprintf("plugin:%s:%s", sanitizedID, name)
		} else {
			id = fmt.Sprintf("plugin:%s", name)
		}
	case "user":
		id = fmt.Sprintf("user:%s", name)
	case "project":
		id = fmt.Sprintf("project:%s", name)
	}

	return &Skill{
		ID:           id,
		Name:         name,
		FullName:     fullName,
		Scope:        scope,
		Content:      body,
		Description:  description,
		FilePath:     dirPath,
		PluginID:     pluginID,
		PluginName:   pluginName,
		AllowedTools: allowedTools,
	}
}

// loadSkillFromFile loads a skill from a single markdown file
func loadSkillFromFile(filePath, scope string, pluginID, pluginName *string) *Skill {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	frontmatter, body := parseSkillFrontmatter(string(content))

	name := frontmatter.Name
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(filePath), ".md")
	}

	var description *string
	if frontmatter.Description != "" {
		description = &frontmatter.Description
	}

	allowedTools := []string{}
	if frontmatter.AllowedTools != "" {
		for _, tool := range strings.Split(frontmatter.AllowedTools, ",") {
			allowedTools = append(allowedTools, strings.TrimSpace(tool))
		}
	}

	// Build full name based on scope
	var fullName string
	switch scope {
	case "plugin":
		if pluginName != nil {
			fullName = fmt.Sprintf(":%s:%s", *pluginName, name)
		} else {
			fullName = fmt.Sprintf(":%s", name)
		}
	default:
		fullName = fmt.Sprintf(":%s", name)
	}

	// Build unique ID
	var id string
	switch scope {
	case "plugin":
		if pluginID != nil {
			sanitizedID := strings.ReplaceAll(strings.ReplaceAll(*pluginID, "@", "-"), "/", "-")
			id = fmt.Sprintf("plugin:%s:%s", sanitizedID, name)
		} else {
			id = fmt.Sprintf("plugin:%s", name)
		}
	case "user":
		id = fmt.Sprintf("user:%s", name)
	case "project":
		id = fmt.Sprintf("project:%s", name)
	}

	return &Skill{
		ID:           id,
		Name:         name,
		FullName:     fullName,
		Scope:        scope,
		Content:      body,
		Description:  description,
		FilePath:     filePath,
		PluginID:     pluginID,
		PluginName:   pluginName,
		AllowedTools: allowedTools,
	}
}

// parseSkillFrontmatter parses YAML frontmatter from skill content
func parseSkillFrontmatter(content string) (SkillFrontmatter, string) {
	var fm SkillFrontmatter

	if !strings.HasPrefix(content, "---\n") && !strings.HasPrefix(content, "---\r\n") {
		return fm, content
	}

	startOffset := 4
	if strings.HasPrefix(content, "---\r\n") {
		startOffset = 5
	}

	// Find the closing ---
	endIdx := strings.Index(content[startOffset:], "\n---\n")
	if endIdx == -1 {
		endIdx = strings.Index(content[startOffset:], "\r\n---\r\n")
		if endIdx == -1 {
			return fm, content
		}
	}

	frontmatterStr := content[startOffset : startOffset+endIdx]
	bodyStart := startOffset + endIdx + 5
	if bodyStart < len(content) {
		// Simple YAML parsing for name, description, allowed-tools
		lines := strings.Split(frontmatterStr, "\n")
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

// SkillGet retrieves a specific skill by ID
func (a *App) SkillGet(id, projectPath string) (*Skill, error) {
	skills, err := a.SkillsList(projectPath)
	if err != nil {
		return nil, err
	}

	for _, skill := range skills {
		if skill.ID == id {
			return &skill, nil
		}
	}

	return nil, fmt.Errorf("skill not found: %s", id)
}

// ===== Hooks Validation Bindings =====

// HookValidationResult represents the result of hook command validation
type HookValidationResult struct {
	Valid   bool   `json:"valid"`
	Message string `json:"message"`
}

// ValidateHookCommand validates a hook command
func (a *App) ValidateHookCommand(cmd string) (*HookValidationResult, error) {
	if cmd == "" {
		return &HookValidationResult{
			Valid:   false,
			Message: "Command cannot be empty",
		}, nil
	}

	// Split command to get the executable
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return &HookValidationResult{
			Valid:   false,
			Message: "Command cannot be empty",
		}, nil
	}

	executable := parts[0]

	// Check if it's an absolute path
	if filepath.IsAbs(executable) {
		if _, err := os.Stat(executable); err != nil {
			return &HookValidationResult{
				Valid:   false,
				Message: fmt.Sprintf("Executable not found: %s", executable),
			}, nil
		}
		return &HookValidationResult{
			Valid:   true,
			Message: "Command is valid",
		}, nil
	}

	// Check if command exists in PATH
	if _, err := exec.LookPath(executable); err != nil {
		return &HookValidationResult{
			Valid:   false,
			Message: fmt.Sprintf("Command not found in PATH: %s", executable),
		}, nil
	}

	return &HookValidationResult{
		Valid:   true,
		Message: "Command is valid",
	}, nil
}

// GetMergedHooksConfig returns merged hooks config from global and project levels
func (a *App) GetMergedHooksConfig(projectPath string) (*claude.HooksConfig, error) {
	if a.config == nil {
		return &claude.HooksConfig{}, nil
	}

	// Get global hooks
	globalHooks, err := claude.GetHooks(a.config.ClaudeDir)
	if err != nil {
		globalHooks = &claude.HooksConfig{}
	}

	// If no project path, return global only
	if projectPath == "" {
		return globalHooks, nil
	}

	// Get project-level hooks
	projectClaudeDir := filepath.Join(projectPath, ".claude")
	projectSettingsPath := filepath.Join(projectClaudeDir, "settings.json")

	projectSettings, err := claude.LoadSettings(projectSettingsPath)
	if err != nil || projectSettings == nil {
		return globalHooks, nil
	}

	// Extract project hooks
	hooksData, ok := projectSettings["hooks"]
	if !ok {
		return globalHooks, nil
	}

	hooksJSON, err := json.Marshal(hooksData)
	if err != nil {
		return globalHooks, nil
	}

	var projectHooks claude.HooksConfig
	if err := json.Unmarshal(hooksJSON, &projectHooks); err != nil {
		return globalHooks, nil
	}

	// Merge hooks (project hooks take precedence)
	mergedHooks := &claude.HooksConfig{
		PreToolUse:   mergeHookMatchers(globalHooks.PreToolUse, projectHooks.PreToolUse),
		PostToolUse:  mergeHookMatchers(globalHooks.PostToolUse, projectHooks.PostToolUse),
		Notification: mergeHookMatchers(globalHooks.Notification, projectHooks.Notification),
		Stop:         mergeHookMatchers(globalHooks.Stop, projectHooks.Stop),
	}

	return mergedHooks, nil
}

// mergeHookMatchers merges two slices of HookMatcher (project takes precedence for same matcher)
func mergeHookMatchers(global, project []claude.HookMatcher) []claude.HookMatcher {
	if len(project) == 0 {
		return global
	}
	if len(global) == 0 {
		return project
	}

	// Create map of project matchers by matcher pattern
	projectMatchers := make(map[string]claude.HookMatcher)
	for _, m := range project {
		projectMatchers[m.Matcher] = m
	}

	// Add global matchers that aren't overridden by project
	result := make([]claude.HookMatcher, 0, len(global)+len(project))
	for _, m := range global {
		if _, exists := projectMatchers[m.Matcher]; !exists {
			result = append(result, m)
		}
	}

	// Add all project matchers
	result = append(result, project...)

	return result
}

// ===== Provider API Config Update Binding =====

// UpdateProviderApiConfig updates an existing provider API configuration
func (a *App) UpdateProviderApiConfig(id string, updates map[string]interface{}) (*database.ProviderApiConfig, error) {
	if a.dbManager == nil {
		return nil, fmt.Errorf("database manager not initialized")
	}

	// Get existing config
	config, err := a.dbManager.GetProviderApiConfig(id)
	if err != nil {
		return nil, err
	}

	// Apply updates
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
		// If setting as default, clear other defaults for the same provider first
		if isDefault {
			if err := a.dbManager.ClearDefaultProviderApiConfig(config.ProviderID); err != nil {
				return nil, err
			}
		}
		config.IsDefault = isDefault
	}

	// Save updated config
	if err := a.dbManager.SaveProviderApiConfig(config); err != nil {
		return nil, err
	}

	return config, nil
}

// ===== SSH Connection Testing Binding =====

// TestSshConnection tests an SSH connection
func (a *App) TestSshConnection(conn ssh.SshConnection) error {
	if a.sshManager == nil {
		return fmt.Errorf("SSH manager not initialized")
	}

	// Build SSH command to test connection
	sshArgs := []string{
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
		"-o", "StrictHostKeyChecking=no",
		"-p", fmt.Sprintf("%d", conn.Port),
	}

	if conn.KeyPath != "" {
		sshArgs = append(sshArgs, "-i", conn.KeyPath)
	}

	sshArgs = append(sshArgs, fmt.Sprintf("%s@%s", conn.User, conn.Host), "echo", "Connection successful")

	cmd := exec.Command("ssh", sshArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("SSH connection failed: %s - %s", err.Error(), string(output))
	}

	return nil
}

// ===== Git Clone Repository Binding =====

// CloneRepositoryResult represents the result of cloning a repository
type CloneRepositoryResult struct {
	ID        string   `json:"id"`
	Path      string   `json:"path"`
	Sessions  []string `json:"sessions"`
	CreatedAt int64    `json:"created_at"`
}

// CloneRepository clones a git repository
func (a *App) CloneRepository(repoUrl, destPath, branch string) (*CloneRepositoryResult, error) {
	// Build git clone command
	args := []string{"clone"}

	if branch != "" {
		args = append(args, "-b", branch)
	}

	args = append(args, repoUrl)

	if destPath != "" {
		args = append(args, destPath)
	}

	cmd := exec.Command("git", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git clone failed: %s - %s", err.Error(), string(output))
	}

	// Determine the actual destination path
	actualPath := destPath
	if actualPath == "" {
		// Extract repo name from URL
		parts := strings.Split(repoUrl, "/")
		repoName := parts[len(parts)-1]
		repoName = strings.TrimSuffix(repoName, ".git")
		cwd, _ := os.Getwd()
		actualPath = filepath.Join(cwd, repoName)
	}

	// Add to project index
	if a.dbManager != nil {
		a.AddProjectToIndex(actualPath)
	}

	return &CloneRepositoryResult{
		ID:        filepath.Base(actualPath),
		Path:      actualPath,
		Sessions:  []string{},
		CreatedAt: time.Now().Unix(),
	}, nil
}

// ===== Branch Notification Binding =====

// NotifyBranchRenamed notifies about a branch rename
func (a *App) NotifyBranchRenamed(path, branch string) error {
	// Update workspace branch in database
	if a.dbManager != nil {
		return a.UpdateWorkspaceBranch(path, branch)
	}
	return nil
}
