package main

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/rpc"
)

type rpcSession interface {
	Close() error
}

type cliDeps struct {
	loadConfig func() (*config.Config, error)
	openDB     func(path string) (*database.Database, error)
	dialRPC    func(wsURL string, authKey string) (rpcSession, error)
	now        func() time.Time
}

type cliState struct {
	stdout       io.Writer
	stderr       io.Writer
	deps         cliDeps
	instanceFlag string
}

func defaultCLIDeps() cliDeps {
	return cliDeps{
		loadConfig: config.Load,
		openDB:     database.Open,
		dialRPC: func(wsURL string, authKey string) (rpcSession, error) {
			return rpc.Dial(wsURL, authKey)
		},
		now: time.Now,
	}
}

func runCLIArgs(args []string, stdout io.Writer, stderr io.Writer, deps cliDeps) error {
	args, instanceFlag, err := stripGlobalFlags(args)
	if err != nil {
		return err
	}

	state := cliState{
		stdout:       stdout,
		stderr:       stderr,
		deps:         deps,
		instanceFlag: instanceFlag,
	}

	if len(args) == 0 {
		writeUsage(stderr)
		return errors.New("command required")
	}

	switch args[0] {
	case "help", "-h", "--help":
		writeUsage(stdout)
		return nil
	case "instance":
		return runInstanceCommand(state, args[1:])
	case "context":
		return runContextCommand(state, args[1:])
	default:
		writeUsage(stderr)
		return fmt.Errorf("unknown command %q", strings.Join(args, " "))
	}
}

func stripGlobalFlags(args []string) ([]string, string, error) {
	cleaned := make([]string, 0, len(args))
	var instance string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--instance":
			if i+1 >= len(args) {
				return nil, "", errors.New("--instance requires a value")
			}
			instance = args[i+1]
			i++
		case strings.HasPrefix(arg, "--instance="):
			instance = strings.TrimPrefix(arg, "--instance=")
		default:
			cleaned = append(cleaned, arg)
		}
	}

	return cleaned, instance, nil
}

func writeUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode instance list")
	fmt.Fprintln(w, "  ropcode instance current")
	fmt.Fprintln(w, "  ropcode instance use <id>")
	fmt.Fprintln(w, "  ropcode context show [--instance <id>]")
}
