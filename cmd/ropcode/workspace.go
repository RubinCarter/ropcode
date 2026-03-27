package main

import (
	"errors"
	"fmt"
	"strings"

	"ropcode/internal/config"
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
	projectName, err := resolveWorkspaceProjectArg(state, args)
	if err != nil {
		return err
	}

	project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: projectName})
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
	projectName, workspaceName, err := parseWorkspaceUseArgs(state, args)
	if err != nil {
		return err
	}

	project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: projectName})
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

func resolveWorkspaceProjectArg(state cliState, args []string) (string, error) {
	if state.projectFlag != "" {
		if len(args) != 0 {
			return "", errors.New("usage: ropcode workspace list --project <name-or-path>")
		}
		return state.projectFlag, nil
	}
	if len(args) == 2 && args[0] == "--project" && args[1] != "" {
		return args[1], nil
	}
	return "", errors.New("usage: ropcode workspace list --project <name-or-path>")
}

func parseWorkspaceUseArgs(state cliState, args []string) (string, string, error) {
	if state.projectFlag != "" {
		if len(args) != 1 || args[0] == "" {
			return "", "", errors.New("usage: ropcode workspace use --project <name-or-path> <workspace-name>")
		}
		return state.projectFlag, args[0], nil
	}
	if len(args) == 3 && args[0] == "--project" && args[1] != "" && args[2] != "" {
		return args[1], args[2], nil
	}
	return "", "", errors.New("usage: ropcode workspace use --project <name-or-path> <workspace-name>")
}
