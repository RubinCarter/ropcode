package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"ropcode/internal/config"
	"ropcode/internal/database"
)

type cliFocusContext struct {
	ProjectName   string `json:"project_name,omitempty"`
	ProjectPath   string `json:"project_path,omitempty"`
	WorkspaceName string `json:"workspace_name,omitempty"`
	WorkspacePath string `json:"workspace_path,omitempty"`
	SessionID     string `json:"session_id,omitempty"`
}

func loadCLIContext(cfg *config.Config) (cliFocusContext, error) {
	data, err := os.ReadFile(cfg.CLIContextPath())
	if errors.Is(err, os.ErrNotExist) {
		return cliFocusContext{}, nil
	}
	if err != nil {
		return cliFocusContext{}, err
	}
	var ctx cliFocusContext
	if err := json.Unmarshal(data, &ctx); err != nil {
		return cliFocusContext{}, err
	}
	return ctx, nil
}

func saveCLIContext(cfg *config.Config, ctx cliFocusContext) error {
	data, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfg.CLIContextPath(), append(data, '\n'), 0644)
}

func clearCLIContext(cfg *config.Config) error {
	if err := os.Remove(cfg.CLIContextPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func runFocusCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeFocusUsage(state.stdout)
		return nil
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if len(args) == 1 && args[0] == "--clear" {
		if err := clearCLIContext(cfg); err != nil {
			return err
		}
		fmt.Fprintln(state.stdout, "focus cleared")
		return nil
	}

	if len(args) == 0 {
		if err := ensurePWDProjectContext(&state); err != nil {
			return err
		}
		if !state.pwdFromFocus && (state.pwdRole == pwdRoleInsideWorkspace || state.pwdRole == pwdRoleProjectRoot) {
			return focusFromPWD(state, cfg)
		}
		return showFocus(state, cfg)
	}

	projectName, workspaceName, sessionID, err := parseFocusArgs(args)
	if err != nil {
		return err
	}
	project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: projectName})
	if err != nil {
		return err
	}

	focus := cliFocusContext{
		ProjectName: project.Name,
		ProjectPath: projectPrimaryPath(project),
		SessionID:   sessionID,
	}
	if workspaceName != "" {
		ws := findWorkspaceByName(project.Workspaces, workspaceName)
		if ws == nil {
			return fmt.Errorf("workspace %q not found in project %q", workspaceName, project.Name)
		}
		focus.WorkspaceName = ws.Name
		focus.WorkspacePath = workspacePrimaryPath(ws)
	}
	if err := saveCLIContext(cfg, focus); err != nil {
		return err
	}
	printFocus(state.stdout, "focused", focus)
	return nil
}

func parseFocusArgs(args []string) (projectName string, workspaceName string, sessionID string, err error) {
	positionals := make([]string, 0, 2)
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--session":
			if i+1 >= len(args) {
				return "", "", "", errors.New("--session requires a value")
			}
			sessionID = args[i+1]
			i++
		default:
			if strings.HasPrefix(args[i], "-") {
				return "", "", "", fmt.Errorf("unknown flag %q", args[i])
			}
			positionals = append(positionals, args[i])
		}
	}
	if len(positionals) == 0 || len(positionals) > 2 {
		return "", "", "", errors.New("usage: ropcode focus <project> [workspace] [--session <id>]")
	}
	projectName = positionals[0]
	if len(positionals) == 2 {
		workspaceName = positionals[1]
	}
	return projectName, workspaceName, sessionID, nil
}

func showFocus(state cliState, cfg *config.Config) error {
	focus, err := loadCLIContext(cfg)
	if err != nil {
		return err
	}
	if focus.ProjectName == "" && focus.ProjectPath == "" {
		fmt.Fprintln(state.stdout, "no focus set")
		fmt.Fprintln(state.stdout, "Run `ropcode focus <project> [workspace]` to set one.")
		return nil
	}
	printFocus(state.stdout, "current focus", focus)
	return nil
}

func focusFromPWD(state cliState, cfg *config.Config) error {
	if state.pwdProj == nil {
		return showFocus(state, cfg)
	}
	focus := mainWorkspaceContext(state.pwdProj)
	if state.pwdRole == pwdRoleInsideWorkspace && state.pwdWS != nil {
		focus.WorkspaceName = state.pwdWS.Name
		focus.WorkspacePath = workspacePrimaryPath(state.pwdWS)
	}
	if err := saveCLIContext(cfg, focus); err != nil {
		return err
	}
	printFocus(state.stdout, "focused", focus)
	return nil
}

func printFocus(w interface{ Write([]byte) (int, error) }, label string, focus cliFocusContext) {
	fmt.Fprintln(w, label)
	if focus.ProjectName != "" || focus.ProjectPath != "" {
		fmt.Fprintf(w, "PROJECT\t%s\t%s\n", focus.ProjectName, focus.ProjectPath)
	}
	if focus.WorkspaceName != "" || focus.WorkspacePath != "" {
		fmt.Fprintf(w, "WORKSPACE\t%s\t%s\n", focus.WorkspaceName, focus.WorkspacePath)
	}
	if focus.SessionID != "" {
		fmt.Fprintf(w, "SESSION\t%s\n", focus.SessionID)
	}
}

func printFocusedState(w interface{ Write([]byte) (int, error) }, state cliState) {
	if !state.pwdFromFocus && (state.pwdRole == pwdRoleInsideWorkspace || state.pwdRole == pwdRoleProjectRoot) {
		return
	}
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return
	}
	focus, err := loadCLIContext(cfg)
	if err != nil || (focus.ProjectName == "" && focus.ProjectPath == "") {
		return
	}
	printFocus(w, "current focus", focus)
	fmt.Fprintln(w, "")
}

func writeFocusUsage(w interface{ Write([]byte) (int, error) }) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode focus")
	fmt.Fprintln(w, "  ropcode focus <project> [workspace] [--session <id>]")
	fmt.Fprintln(w, "  ropcode focus --clear")
}

func applyFocusContext(state *cliState, projects []*database.ProjectIndex) bool {
	if state.cwdFlag != "" || state.projectFlag != "" || state.workspaceFlag != "" {
		return false
	}
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return false
	}
	focus, err := loadCLIContext(cfg)
	if err != nil || focus.ProjectPath == "" {
		return false
	}
	project := findProject(projects, focus.ProjectPath)
	if project == nil && focus.ProjectName != "" {
		project = findProject(projects, focus.ProjectName)
	}
	if project == nil {
		return false
	}
	state.pwdRole = pwdRoleProjectRoot
	state.pwdProj = project
	state.pwdFromFocus = true
	if focus.WorkspacePath != "" {
		for i := range project.Workspaces {
			ws := &project.Workspaces[i]
			if pathMatchesOrContains(workspacePrimaryPath(ws), focus.WorkspacePath) {
				state.pwdRole = pwdRoleInsideWorkspace
				state.pwdWS = ws
				state.focusSessionID = focus.SessionID
				return true
			}
		}
	}
	state.focusSessionID = focus.SessionID
	return true
}
