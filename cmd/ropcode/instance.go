package main

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"ropcode/internal/config"
)

func runInstanceCommand(state cliState, args []string) error {
	if len(args) == 0 {
		writeInstanceUsage(state.stderr)
		return errors.New("instance subcommand required")
	}
	if isHelpArg(args[0]) {
		writeInstanceUsage(state.stdout)
		return nil
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	switch args[0] {
	case "list":
		return runInstanceList(state, cfg)
	case "current":
		if len(args) != 1 {
			writeInstanceUsage(state.stderr)
			return errors.New("usage: ropcode catalog instance current [--instance <id>]")
		}
		return runInstanceCurrent(state, cfg)
	default:
		return fmt.Errorf("unknown instance subcommand %q", strings.Join(args, " "))
	}
}

func writeInstanceUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode catalog instance list")
	fmt.Fprintln(w, "  ropcode catalog instance current [--instance <id>]")
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
