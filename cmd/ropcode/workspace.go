package main

import (
	"errors"
	"fmt"
	"strings"

	"ropcode/internal/config"
	"ropcode/internal/database"
)

func runWorkspaceCommand(state cliState, args []string) error {
	if len(args) == 0 {
		return errors.New("workspace subcommand required")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "list":
		return runWorkspaceList(state, cfg, args[1:])
	case "use":
		return runWorkspaceUse(state, cfg, args[1:])
	default:
		return fmt.Errorf("unknown workspace subcommand %q", strings.Join(args, " "))
	}
}

func runWorkspaceList(state cliState, cfg *config.Config, args []string) error {
	project, err := resolveWorkspaceProject(state, cfg, args)
	if err != nil {
		return err
	}
	if len(project.Workspaces) == 0 {
		fmt.Fprintf(state.stdout, "no workspaces found for project %s\n", project.Name)
		return nil
	}

	fmt.Fprintln(state.stdout, "WORKSPACE\tPATH")
	for i := range project.Workspaces {
		workspace := &project.Workspaces[i]
		fmt.Fprintf(state.stdout, "%s\t%s\n", workspace.Name, workspacePrimaryPath(workspace))
	}
	return nil
}

func runWorkspaceUse(state cliState, cfg *config.Config, args []string) error {
	project, workspaceName, err := resolveWorkspaceUseSelection(state, cfg, args)
	if err != nil {
		return err
	}

	workspace, _, err := resolveWorkspace(state.deps, cfg, project, workspaceResolutionOptions{explicitWorkspace: workspaceName})
	if err != nil {
		return err
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return fmt.Errorf("load cli context: %w", err)
	}
	ctx.CurrentProject = project.Name
	ctx.CurrentProjectPath = projectPrimaryPath(project)
	ctx.CurrentWorkspace = workspace.Name
	ctx.CurrentWorkspacePath = workspacePrimaryPath(workspace)
	ctx.CurrentCWD = workspacePrimaryPath(workspace)
	if err := saveCLIContext(cfg, ctx); err != nil {
		return fmt.Errorf("save cli context: %w", err)
	}

	fmt.Fprintf(state.stdout, "current workspace set to %s\n", workspace.Name)
	return nil
}

func resolveWorkspaceProject(state cliState, cfg *config.Config, args []string) (*database.ProjectIndex, error) {
	if len(args) != 0 {
		return nil, workspaceUsageError("list")
	}
	project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{
		explicitProject: state.projectFlag,
		explicitCWD:     state.cwdFlag,
	})
	if err != nil {
		return nil, err
	}
	return project, nil
}

func resolveWorkspaceUseSelection(state cliState, cfg *config.Config, args []string) (*database.ProjectIndex, string, error) {
	if len(args) != 1 || args[0] == "" {
		return nil, "", workspaceUsageError("use")
	}
	project, err := resolveWorkspaceProject(state, cfg, nil)
	if err != nil {
		return nil, "", err
	}
	return project, args[0], nil
}

func workspaceUsageError(subcommand string) error {
	switch subcommand {
	case "list":
		return errors.New("usage: ropcode workspace list [--project <name-or-path>]")
	case "use":
		return errors.New("usage: ropcode workspace use [--project <name-or-path>] <workspace-name>")
	default:
		return errors.New("usage: ropcode workspace")
	}
}
