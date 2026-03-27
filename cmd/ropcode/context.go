package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	appRuntime "ropcode/internal/runtime"
)

var staleGracePeriod = 90 * time.Second

type cliContext struct {
	CurrentInstanceID    string `json:"current_instance_id,omitempty"`
	CurrentProject       string `json:"current_project,omitempty"`
	CurrentProjectPath   string `json:"current_project_path,omitempty"`
	CurrentWorkspace     string `json:"current_workspace,omitempty"`
	CurrentWorkspacePath string `json:"current_workspace_path,omitempty"`
	CurrentCWD           string `json:"current_cwd,omitempty"`
	CurrentSessionID     string `json:"current_session_id,omitempty"`
}

type projectResolutionOptions struct {
	explicitProject string
	explicitCWD     string
}

type workspaceResolutionOptions struct {
	explicitWorkspace string
	explicitCWD       string
}

func runContextCommand(state cliState, args []string) error {
	if len(args) != 1 {
		return errors.New("usage: ropcode context show|clear")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "show":
		return runContextShow(state, cfg)
	case "clear":
		return runContextClear(state, cfg)
	default:
		return errors.New("usage: ropcode context show|clear")
	}
}

func runContextShow(state cliState, cfg *config.Config) error {
	record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return err
	}

	client, err := state.deps.dialRPC(instanceWSURL(record), record.AuthKey)
	if err != nil {
		return fmt.Errorf("attach to instance %s: %w", record.ID, err)
	}
	defer client.Close()

	project, projectSource, projectErr := resolveProject(state.deps, cfg, projectResolutionOptions{
		explicitProject: state.projectFlag,
		explicitCWD:     state.cwdFlag,
	})
	workspace, workspaceSource, workspaceErr := resolveWorkspace(state.deps, cfg, project, workspaceResolutionOptions{
		explicitWorkspace: state.workspaceFlag,
		explicitCWD:       state.cwdFlag,
	})

	fmt.Fprintf(state.stdout, "instance\t%s\n", record.ID)
	fmt.Fprintf(state.stdout, "instance_source\t%s\n", source)
	fmt.Fprintf(state.stdout, "url\t%s\n", instanceWSURL(record))
	fmt.Fprintf(state.stdout, "status\tattached\n")
	if projectErr == nil {
		fmt.Fprintf(state.stdout, "project\t%s\n", project.Name)
		fmt.Fprintf(state.stdout, "project_source\t%s\n", projectSource)
		if path := projectPrimaryPath(project); path != "" {
			fmt.Fprintf(state.stdout, "project_path\t%s\n", path)
		}
	}
	if workspaceErr == nil {
		fmt.Fprintf(state.stdout, "workspace\t%s\n", workspace.Name)
		fmt.Fprintf(state.stdout, "workspace_source\t%s\n", workspaceSource)
		if path := workspacePrimaryPath(workspace); path != "" {
			fmt.Fprintf(state.stdout, "cwd\t%s\n", path)
		}
	} else if projectErr == nil {
		if cwd := projectPrimaryPath(project); cwd != "" {
			fmt.Fprintf(state.stdout, "cwd\t%s\n", cwd)
		}
	}
	return nil
}

func runContextClear(state cliState, cfg *config.Config) error {
	if err := saveCLIContext(cfg, cliContext{}); err != nil {
		return fmt.Errorf("save cli context: %w", err)
	}
	fmt.Fprintln(state.stdout, "context cleared")
	return nil
}

func loadCLIContext(cfg *config.Config) (cliContext, error) {
	data, err := os.ReadFile(cfg.CLIContextPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cliContext{}, nil
		}
		return cliContext{}, err
	}
	if len(data) == 0 {
		return cliContext{}, nil
	}

	var ctx cliContext
	if err := json.Unmarshal(data, &ctx); err != nil {
		return cliContext{}, err
	}
	return ctx, nil
}

func saveCLIContext(cfg *config.Config, ctx cliContext) error {
	data, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfg.CLIContextPath(), data, 0644)
}

func resolveInstance(deps cliDeps, cfg *config.Config, explicitID string) (*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(deps, cfg)
	if err != nil {
		return nil, "", err
	}

	if explicitID != "" {
		record := findInstanceByID(alive, explicitID)
		if record == nil {
			return nil, "", fmt.Errorf("instance %q is not alive; run `ropcode instance list`", explicitID)
		}
		return record, "explicit", nil
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	if ctx.CurrentInstanceID != "" {
		record := findInstanceByID(alive, ctx.CurrentInstanceID)
		if record != nil {
			return record, "saved", nil
		}
	}

	if len(alive) == 1 {
		return alive[0], "auto", nil
	}
	if len(alive) == 0 {
		return nil, "", errors.New("no alive instances found; start ropcode and run `ropcode instance list`")
	}

	var msg strings.Builder
	msg.WriteString("multiple alive instances found; use `ropcode instance use <id>` or pass `--instance <id>`")
	if ctx.CurrentInstanceID != "" {
		fmt.Fprintf(&msg, " (saved instance %q is unavailable)", ctx.CurrentInstanceID)
	}
	return nil, "", errors.New(msg.String())
}

func resolveProject(deps cliDeps, cfg *config.Config, opts projectResolutionOptions) (*database.ProjectIndex, string, error) {
	projects, err := listProjects(deps, cfg)
	if err != nil {
		return nil, "", err
	}
	if len(projects) == 0 {
		return nil, "", errors.New("no projects found; run `ropcode project list`")
	}

	if opts.explicitCWD != "" {
		if project := findProjectByWorkspacePath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		if project := findProjectByPath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project for cwd %q not found; run `ropcode project list`", opts.explicitCWD)
	}
	if opts.explicitProject != "" {
		if project := findProject(projects, opts.explicitProject); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project %q not found; run `ropcode project list`", opts.explicitProject)
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	if ctx.CurrentCWD != "" {
		if project := findProjectByWorkspacePath(projects, ctx.CurrentCWD); project != nil {
			return project, "saved", nil
		}
		if project := findProjectByPath(projects, ctx.CurrentCWD); project != nil {
			return project, "saved", nil
		}
	}
	if ctx.CurrentProjectPath != "" {
		if project := findProjectByPath(projects, ctx.CurrentProjectPath); project != nil {
			return project, "saved", nil
		}
	}
	if ctx.CurrentProject != "" {
		if project := findProject(projects, ctx.CurrentProject); project != nil {
			return project, "saved", nil
		}
	}

	if len(projects) == 1 {
		return projects[0], "auto", nil
	}
	return nil, "", errors.New("multiple projects found; use `--project <name-or-path>` or run `ropcode project list`")
}

func resolveWorkspace(deps cliDeps, cfg *config.Config, project *database.ProjectIndex, opts workspaceResolutionOptions) (*database.WorkspaceIndex, string, error) {
	if project == nil {
		return nil, "", errors.New("project context required before resolving workspace")
	}
	workspaces := append([]database.WorkspaceIndex(nil), project.Workspaces...)
	if len(workspaces) == 0 {
		return nil, "", fmt.Errorf("project %q has no indexed workspaces; run `ropcode workspace list --project %s`", project.Name, project.Name)
	}

	if opts.explicitCWD != "" {
		if workspace := findWorkspaceByPath(workspaces, opts.explicitCWD); workspace != nil {
			return workspace, "explicit", nil
		}
	}
	if opts.explicitWorkspace != "" {
		if workspace := findWorkspaceByName(workspaces, opts.explicitWorkspace); workspace != nil {
			return workspace, "explicit", nil
		}
		return nil, "", fmt.Errorf("workspace %q not found in project %q; run `ropcode workspace list --project %s`", opts.explicitWorkspace, project.Name, project.Name)
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	if ctx.CurrentCWD != "" {
		if workspace := findWorkspaceByPath(workspaces, ctx.CurrentCWD); workspace != nil {
			return workspace, "saved", nil
		}
	}
	if ctx.CurrentWorkspacePath != "" {
		if workspace := findWorkspaceByPath(workspaces, ctx.CurrentWorkspacePath); workspace != nil {
			return workspace, "saved", nil
		}
	}
	if ctx.CurrentWorkspace != "" {
		if workspace := findWorkspaceByName(workspaces, ctx.CurrentWorkspace); workspace != nil {
			return workspace, "saved", nil
		}
	}

	if len(workspaces) == 1 {
		return &workspaces[0], "auto", nil
	}
	return nil, "", fmt.Errorf("multiple workspaces found for project %q; use `--workspace <name>` or run `ropcode workspace list --project %s`", project.Name, project.Name)
}

func listAliveInstancesForOutput(state cliState, cfg *config.Config) ([]*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(state.deps, cfg)
	if err != nil {
		return nil, "", err
	}
	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return nil, "", fmt.Errorf("load cli context: %w", err)
	}
	return alive, ctx.CurrentInstanceID, nil
}

func listAliveInstances(deps cliDeps, cfg *config.Config) ([]*database.InstanceRecord, error) {
	db, err := deps.openDB(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	registry := appRuntime.NewRegistry(db)
	cutoff := deps.now().Add(-staleGracePeriod).UnixMilli()
	instances, err := registry.ListAliveInstances(cutoff)
	if err != nil {
		return nil, fmt.Errorf("list alive instances: %w", err)
	}
	return instances, nil
}

func listProjects(deps cliDeps, cfg *config.Config) ([]*database.ProjectIndex, error) {
	db, err := deps.openDB(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	projects, err := db.GetAllProjectIndexes()
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].Name < projects[j].Name
	})
	return projects, nil
}

func findInstanceByID(instances []*database.InstanceRecord, id string) *database.InstanceRecord {
	for _, inst := range instances {
		if inst.ID == id {
			return inst
		}
	}
	return nil
}

func pathMatchesOrContains(basePath, candidate string) bool {
	if basePath == "" || candidate == "" {
		return false
	}
	cleanBase := filepath.Clean(basePath)
	cleanCandidate := filepath.Clean(candidate)
	if cleanBase == cleanCandidate {
		return true
	}
	rel, err := filepath.Rel(cleanBase, cleanCandidate)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func findProject(projects []*database.ProjectIndex, nameOrPath string) *database.ProjectIndex {
	for _, project := range projects {
		if project.Name == nameOrPath || projectPrimaryPath(project) == nameOrPath {
			return project
		}
	}
	return nil
}

func findProjectByPath(projects []*database.ProjectIndex, path string) *database.ProjectIndex {
	for _, project := range projects {
		if pathMatchesOrContains(projectPrimaryPath(project), path) {
			return project
		}
	}
	return nil
}

func findProjectByWorkspacePath(projects []*database.ProjectIndex, path string) *database.ProjectIndex {
	for _, project := range projects {
		for i := range project.Workspaces {
			if pathMatchesOrContains(workspacePrimaryPath(&project.Workspaces[i]), path) {
				return project
			}
		}
	}
	return nil
}

func findWorkspaceByName(workspaces []database.WorkspaceIndex, name string) *database.WorkspaceIndex {
	for i := range workspaces {
		if workspaces[i].Name == name {
			return &workspaces[i]
		}
	}
	return nil
}

func findWorkspaceByPath(workspaces []database.WorkspaceIndex, path string) *database.WorkspaceIndex {
	for i := range workspaces {
		if pathMatchesOrContains(workspacePrimaryPath(&workspaces[i]), path) {
			return &workspaces[i]
		}
	}
	return nil
}

func projectPrimaryPath(project *database.ProjectIndex) string {
	if project == nil || len(project.Providers) == 0 {
		return ""
	}
	return project.Providers[0].Path
}

func workspacePrimaryPath(workspace *database.WorkspaceIndex) string {
	if workspace == nil || len(workspace.Providers) == 0 {
		return ""
	}
	return workspace.Providers[0].Path
}

func instanceWSURL(record *database.InstanceRecord) string {
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("ws://%s:%d/ws", host, record.Port)
}
