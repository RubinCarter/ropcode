package main

import (
	"errors"
	"fmt"
	"strings"

	"ropcode/internal/config"
)

func runProjectCommand(state cliState, args []string) error {
	if len(args) == 0 {
		return errors.New("project subcommand required")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "list":
		if len(args) != 1 {
			return errors.New("usage: ropcode project list")
		}
		return runProjectList(state, cfg)
	case "show":
		if len(args) != 2 {
			return errors.New("usage: ropcode project show <name-or-path>")
		}
		return runProjectShow(state, cfg, args[1])
	default:
		return fmt.Errorf("unknown project subcommand %q", strings.Join(args, " "))
	}
}

func runProjectList(state cliState, cfg *config.Config) error {
	projects, err := listProjects(state.deps, cfg)
	if err != nil {
		return err
	}
	if len(projects) == 0 {
		fmt.Fprintln(state.stdout, "no projects found")
		return nil
	}

	fmt.Fprintln(state.stdout, "PROJECT\tPATH")
	for _, project := range projects {
		fmt.Fprintf(state.stdout, "%s\t%s\n", project.Name, projectPrimaryPath(project))
	}
	return nil
}

func runProjectShow(state cliState, cfg *config.Config, nameOrPath string) error {
	project, source, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: nameOrPath})
	if err != nil {
		return err
	}

	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return fmt.Errorf("load cli context: %w", err)
	}

	fmt.Fprintf(state.stdout, "project\t%s\n", project.Name)
	fmt.Fprintf(state.stdout, "project_source\t%s\n", source)
	if path := projectPrimaryPath(project); path != "" {
		fmt.Fprintf(state.stdout, "path\t%s\n", path)
	}
	fmt.Fprintf(state.stdout, "workspaces\t%d\n", len(project.Workspaces))
	if ctx.CurrentProject != "" {
		fmt.Fprintf(state.stdout, "saved_project\t%s\n", ctx.CurrentProject)
	}
	if ctx.CurrentProjectPath != "" {
		fmt.Fprintf(state.stdout, "saved_project_path\t%s\n", ctx.CurrentProjectPath)
	}
	return nil
}
