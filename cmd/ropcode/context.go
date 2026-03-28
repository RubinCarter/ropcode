package main

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	appRuntime "ropcode/internal/runtime"
)

var staleGracePeriod = 90 * time.Second

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
		writeContextUsage(state.stderr)
		return errors.New("usage: ropcode runtime context show")
	}
	if isHelpArg(args[0]) {
		writeContextUsage(state.stdout)
		return nil
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "show":
		return runContextShow(state, cfg)
	default:
		writeContextUsage(state.stderr)
		return errors.New("usage: ropcode runtime context show")
	}
}

func writeContextUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode runtime context show --instance <id> [--project <name-or-path>] [--workspace <name>] [--cwd <path>]")
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

func resolveInstance(deps cliDeps, cfg *config.Config, explicitID string) (*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(deps, cfg)
	if err != nil {
		return nil, "", err
	}

	if explicitID != "" {
		record := findInstanceByID(alive, explicitID)
		if record == nil {
			return nil, "", fmt.Errorf("instance %q is not alive; run `ropcode catalog`", explicitID)
		}
		return record, "explicit", nil
	}

	if len(alive) == 1 {
		return alive[0], "auto", nil
	}
	if len(alive) == 0 {
		return nil, "", errors.New("no alive instances found; start ropcode and run `ropcode catalog`")
	}
	return nil, "", errors.New("multiple alive instances found; pass `--instance <id>` or run `ropcode catalog`")
}

func resolveProject(deps cliDeps, cfg *config.Config, opts projectResolutionOptions) (*database.ProjectIndex, string, error) {
	projects, err := listProjects(deps, cfg)
	if err != nil {
		return nil, "", err
	}
	if len(projects) == 0 {
		return nil, "", errors.New("no projects found; run `ropcode catalog`")
	}

	if opts.explicitCWD != "" {
		if project := findProjectByWorkspacePath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		if project := findProjectByPath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project for cwd %q not found; run `ropcode catalog`", opts.explicitCWD)
	}
	if opts.explicitProject != "" {
		if project := findProject(projects, opts.explicitProject); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project %q not found; run `ropcode catalog`", opts.explicitProject)
	}

	if len(projects) == 1 {
		return projects[0], "auto", nil
	}
	return nil, "", errors.New("multiple projects found; use `--project <name-or-path>` or `--cwd <path>` or run `ropcode catalog`")
}

func resolveWorkspace(deps cliDeps, cfg *config.Config, project *database.ProjectIndex, opts workspaceResolutionOptions) (*database.WorkspaceIndex, string, error) {
	if project == nil {
		return nil, "", errors.New("project context required before resolving workspace")
	}
	workspaces := append([]database.WorkspaceIndex(nil), project.Workspaces...)
	if len(workspaces) == 0 {
		return nil, "", fmt.Errorf("project %q has no indexed workspaces; run `ropcode catalog --project %s`", project.Name, project.Name)
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
		return nil, "", fmt.Errorf("workspace %q not found in project %q; run `ropcode catalog --project %s`", opts.explicitWorkspace, project.Name, project.Name)
	}

	if len(workspaces) == 1 {
		return &workspaces[0], "auto", nil
	}
	return nil, "", fmt.Errorf("multiple workspaces found for project %q; use `--workspace <name>` or `--cwd <path>` or run `ropcode catalog --project %s`", project.Name, project.Name)
}

func listAliveInstancesForOutput(state cliState, cfg *config.Config) ([]*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(state.deps, cfg)
	if err != nil {
		return nil, "", err
	}
	currentID := ""
	if state.instanceFlag != "" {
		currentID = state.instanceFlag
	}
	return alive, currentID, nil
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

func runCatalogCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeCatalogUsage(state.stdout)
		return nil
	}
	if len(args) != 0 {
		writeCatalogUsage(state.stderr)
		return errors.New("usage: ropcode catalog [--instance <id>] [--project <name-or-path>] [--workspace <name>] [--cwd <path>]")
	}
	return runCatalog(state)
}

func writeCatalogUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode catalog [--instance <id>] [--project <name-or-path>] [--workspace <name>] [--cwd <path>]")
}

func runCatalog(state cliState) error {
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if state.workspaceFlag != "" {
		project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: state.projectFlag, explicitCWD: state.cwdFlag})
		if err != nil {
			return err
		}
		workspace, _, err := resolveWorkspace(state.deps, cfg, project, workspaceResolutionOptions{explicitWorkspace: state.workspaceFlag, explicitCWD: state.cwdFlag})
		if err != nil {
			return err
		}
		if state.instanceFlag != "" {
			record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
			if err != nil {
				return err
			}
			fmt.Fprintf(state.stdout, "instance\t%s\n", record.ID)
			fmt.Fprintf(state.stdout, "instance_source\t%s\n", source)
			fmt.Fprintf(state.stdout, "url\t%s\n", instanceWSURL(record))
		}
		fmt.Fprintf(state.stdout, "project\t%s\n", project.Name)
		fmt.Fprintf(state.stdout, "path\t%s\n", projectPrimaryPath(project))
		fmt.Fprintf(state.stdout, "workspace\t%s\n", workspace.Name)
		fmt.Fprintf(state.stdout, "cwd\t%s\n", workspacePrimaryPath(workspace))
		return nil
	}

	if state.projectFlag != "" || state.cwdFlag != "" {
		project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: state.projectFlag, explicitCWD: state.cwdFlag})
		if err != nil {
			return err
		}
		if state.instanceFlag != "" {
			record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
			if err != nil {
				return err
			}
			fmt.Fprintf(state.stdout, "instance\t%s\n", record.ID)
			fmt.Fprintf(state.stdout, "instance_source\t%s\n", source)
			fmt.Fprintf(state.stdout, "url\t%s\n", instanceWSURL(record))
		}
		fmt.Fprintf(state.stdout, "project\t%s\n", project.Name)
		fmt.Fprintf(state.stdout, "path\t%s\n", projectPrimaryPath(project))
		if len(project.Workspaces) == 0 {
			fmt.Fprintln(state.stdout, "workspaces\t(none)")
		} else {
			for i := range project.Workspaces {
				ws := &project.Workspaces[i]
				fmt.Fprintf(state.stdout, "workspace\t%s\t%s\n", ws.Name, workspacePrimaryPath(ws))
			}
		}
		return nil
	}

	if state.instanceFlag != "" {
		record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
		if err != nil {
			return err
		}
		fmt.Fprintf(state.stdout, "instance\t%s\n", record.ID)
		fmt.Fprintf(state.stdout, "instance_source\t%s\n", source)
		fmt.Fprintf(state.stdout, "url\t%s\n", instanceWSURL(record))
		return nil
	}

	instances, _, err := listAliveInstancesForOutput(state, cfg)
	if err != nil {
		return err
	}
	projects, err := listProjects(state.deps, cfg)
	if err != nil {
		return err
	}
	if len(instances) == 0 && len(projects) == 0 {
		fmt.Fprintln(state.stdout, "no instances or projects found")
		return nil
	}
	if len(instances) > 0 {
		fmt.Fprintln(state.stdout, "INSTANCES")
		for _, inst := range instances {
			fmt.Fprintf(state.stdout, "%s\t%s\n", inst.ID, instanceWSURL(inst))
		}
	}
	if len(projects) > 0 {
		if len(instances) > 0 {
			fmt.Fprintln(state.stdout)
		}
		fmt.Fprintln(state.stdout, "PROJECTS")
		for _, project := range projects {
			fmt.Fprintf(state.stdout, "%s\t%s\n", project.Name, projectPrimaryPath(project))
		}
	}
	return nil
}

func instanceWSURL(record *database.InstanceRecord) string {
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("ws://%s:%d/ws", host, record.Port)
}
