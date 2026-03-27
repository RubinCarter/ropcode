package main

import (
	"errors"
	"fmt"
	"strings"

	"ropcode/internal/config"
)

func runInstanceCommand(state cliState, args []string) error {
	if len(args) == 0 {
		return errors.New("instance subcommand required")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "list":
		return runInstanceList(state, cfg)
	case "current":
		return runInstanceCurrent(state, cfg)
	case "use":
		if len(args) != 2 {
			return errors.New("usage: ropcode instance use <id>")
		}
		return runInstanceUse(state, cfg, args[1])
	default:
		return fmt.Errorf("unknown instance subcommand %q", strings.Join(args, " "))
	}
}

func runInstanceList(state cliState, cfg *config.Config) error {
	instances, currentID, err := listAliveInstancesForOutput(state, cfg)
	if err != nil {
		return err
	}
	if len(instances) == 0 {
		fmt.Fprintln(state.stdout, "no alive instances found")
		return nil
	}

	fmt.Fprintln(state.stdout, "CURRENT\tID\tURL")
	for _, inst := range instances {
		marker := ""
		if inst.ID == currentID {
			marker = "*"
		}
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\n", marker, inst.ID, instanceWSURL(inst))
	}
	return nil
}

func runInstanceCurrent(state cliState, cfg *config.Config) error {
	resolved, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return err
	}
	fmt.Fprintf(state.stdout, "%s\t%s\n", resolved.ID, source)
	return nil
}

func runInstanceUse(state cliState, cfg *config.Config, id string) error {
	resolved, _, err := resolveInstance(state.deps, cfg, id)
	if err != nil {
		return err
	}
	ctx, err := loadCLIContext(cfg)
	if err != nil {
		return fmt.Errorf("load cli context: %w", err)
	}
	ctx.CurrentInstanceID = resolved.ID
	if err := saveCLIContext(cfg, ctx); err != nil {
		return fmt.Errorf("save cli context: %w", err)
	}
	fmt.Fprintf(state.stdout, "current instance set to %s\n", resolved.ID)
	return nil
}
