package main

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"ropcode/internal/config"
	"ropcode/internal/database"
)

func runWorkspaceCommand(state cliState, args []string) error {
	if len(args) == 0 {
		writeWorkspaceUsage(state.stderr)
		return errors.New("workspace subcommand required")
	}
	if isHelpArg(args[0]) {
		writeWorkspaceUsage(state.stdout)
		return nil
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "list":
		return runWorkspaceList(state, cfg, args[1:])
	default:
		return fmt.Errorf("unknown workspace subcommand %q", strings.Join(args, " "))
	}
}

func writeWorkspaceUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode workspace list [--project <name-or-path>] [--cwd <path>]")
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

func workspaceUsageError(subcommand string) error {
	switch subcommand {
	case "list":
		return errors.New("usage: ropcode workspace list [--project <name-or-path>] [--cwd <path>]")
	default:
		return errors.New("usage: ropcode workspace")
	}
}
