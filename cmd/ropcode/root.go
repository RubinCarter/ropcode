package main

import (
	"encoding/json"
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
	Call(method string, params []any, out any) error
	OnEvent(eventType string, handler func(payload json.RawMessage))
	Close() error
}

type cliDeps struct {
	loadConfig func() (*config.Config, error)
	openDB     func(path string) (*database.Database, error)
	dialRPC    func(wsURL string, authKey string) (rpcSession, error)
	now        func() time.Time
}

type cliState struct {
	stdout        io.Writer
	stderr        io.Writer
	deps          cliDeps
	instanceFlag  string
	projectFlag   string
	workspaceFlag string
	cwdFlag       string
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
	args, globalFlags, err := stripGlobalFlags(args)
	if err != nil {
		return err
	}

	state := cliState{
		stdout:        stdout,
		stderr:        stderr,
		deps:          deps,
		instanceFlag:  globalFlags.instance,
		projectFlag:   globalFlags.project,
		workspaceFlag: globalFlags.workspace,
		cwdFlag:       globalFlags.cwd,
	}

	if len(args) == 0 {
		writeUsage(stderr)
		return errors.New("command required")
	}

	switch args[0] {
	case "help", "-h", "--help":
		writeUsage(stdout)
		return nil
	case "catalog":
		return runCatalogCommand(state, args[1:])
	case "workspace":
		return runRuntimeWorkspaceCommand(state, args[1:])
	case "runtime":
		return runRuntimeCommand(state, args[1:])
	default:
		writeUsage(stderr)
		return fmt.Errorf("unknown command %q", strings.Join(args, " "))
	}
}

type globalFlags struct {
	instance  string
	project   string
	workspace string
	cwd       string
}

func stripGlobalFlags(args []string) ([]string, globalFlags, error) {
	cleaned := make([]string, 0, len(args))
	var flags globalFlags

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--instance":
			if i+1 >= len(args) {
				return nil, globalFlags{}, errors.New("--instance requires a value")
			}
			flags.instance = args[i+1]
			i++
		case strings.HasPrefix(arg, "--instance="):
			flags.instance = strings.TrimPrefix(arg, "--instance=")
		case arg == "--project":
			if i+1 >= len(args) {
				return nil, globalFlags{}, errors.New("--project requires a value")
			}
			flags.project = args[i+1]
			i++
		case strings.HasPrefix(arg, "--project="):
			flags.project = strings.TrimPrefix(arg, "--project=")
		case arg == "--workspace":
			if i+1 >= len(args) {
				return nil, globalFlags{}, errors.New("--workspace requires a value")
			}
			flags.workspace = args[i+1]
			i++
		case strings.HasPrefix(arg, "--workspace="):
			flags.workspace = strings.TrimPrefix(arg, "--workspace=")
		case arg == "--cwd":
			if i+1 >= len(args) {
				return nil, globalFlags{}, errors.New("--cwd requires a value")
			}
			flags.cwd = args[i+1]
			i++
		case strings.HasPrefix(arg, "--cwd="):
			flags.cwd = strings.TrimPrefix(arg, "--cwd=")
		default:
			cleaned = append(cleaned, arg)
		}
	}

	return cleaned, flags, nil
}

func isHelpArg(arg string) bool {
	return arg == "help" || arg == "-h" || arg == "--help"
}

func writeUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode workspace send --cwd <path> --prompt <text> [--provider <name>] [--model <model>] [--fresh]")
	fmt.Fprintln(w, "  ropcode workspace status [--cwd <path>] [--provider <name>]")
	fmt.Fprintln(w, "  ropcode workspace list [--cwd <path>] [--provider <name>]")
	fmt.Fprintln(w, "  ropcode workspace logs --cwd <path> [--follow]")
	fmt.Fprintln(w, "  ropcode workspace stop --cwd <path>")
	fmt.Fprintln(w, "  ropcode catalog [--instance <id>] [--project <name-or-path>] [--workspace <name>] [--cwd <path>]")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Global flags (optional):")
	fmt.Fprintln(w, "  --instance <id>    Target a specific ropcode instance (auto-detected if omitted)")
	fmt.Fprintln(w, "  --cwd <path>       Workspace directory (can also be passed as subcommand flag)")
}

func runRuntimeCommand(state cliState, args []string) error {
	if len(args) == 0 {
		writeRuntimeUsage(state.stderr)
		return errors.New("runtime subcommand required")
	}
	if isHelpArg(args[0]) {
		writeRuntimeUsage(state.stdout)
		return nil
	}

	switch args[0] {
	case "context":
		return runContextCommand(state, args[1:])
	case "workspace":
		return runRuntimeWorkspaceCommand(state, args[1:])
	case "tui":
		return runTUICommand(state, args[1:])
	default:
		writeRuntimeUsage(state.stderr)
		return fmt.Errorf("unknown runtime subcommand %q", strings.Join(args, " "))
	}
}

func writeRuntimeUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode runtime context show --instance <id> [--project <name-or-path>] [--workspace <name>] [--cwd <path>]")
	fmt.Fprintln(w, "  ropcode runtime workspace start --instance <id> --cwd <path> [--provider <provider>] --prompt <text>")
	fmt.Fprintln(w, "  ropcode runtime workspace send --instance <id> --session <id> --cwd <path> [--provider <provider>] --prompt <text>")
	fmt.Fprintln(w, "  ropcode runtime workspace list --instance <id> [--cwd <path>] [--provider <provider>]")
	fmt.Fprintln(w, "  ropcode runtime workspace logs --instance <id> [--session <id>] [--cwd <path>] [--follow]")
	fmt.Fprintln(w, "  ropcode runtime workspace stop --instance <id> --session <id>")
	fmt.Fprintln(w, "  ropcode runtime tui --instance <id>")
}
