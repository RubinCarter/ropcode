package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
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
	getwd      func() (string, error)
}

type pwdRole int

const (
	pwdRoleUnset pwdRole = iota
	pwdRoleInsideWorkspace
	pwdRoleProjectRoot
	pwdRoleOutside
)

type cliState struct {
	stdout        io.Writer
	stderr        io.Writer
	deps          cliDeps
	instanceFlag  string
	projectFlag   string
	workspaceFlag string
	cwdFlag       string
	allFlag       bool

	pwd       string
	pwdRole   pwdRole
	pwdProj   *database.ProjectIndex
	pwdWS     *database.WorkspaceIndex
}

func defaultCLIDeps() cliDeps {
	return cliDeps{
		loadConfig: config.Load,
		openDB:     database.Open,
		dialRPC: func(wsURL string, authKey string) (rpcSession, error) {
			return rpc.Dial(wsURL, authKey)
		},
		now:   time.Now,
		getwd: os.Getwd,
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
		allFlag:       globalFlags.all,
	}
	resolvePWDContext(&state)

	if len(args) == 0 {
		return runOverviewCommand(state)
	}

	switch args[0] {
	case "help", "-h", "--help":
		writeUsage(stdout)
		return nil
	case "list":
		return runListCommand(state, args[1:])
	case "send":
		return runSendCommand(state, args[1:])
	case "status":
		return runStatusCommand(state, args[1:])
	case "logs":
		return runLogsCommand(state, args[1:])
	case "stop":
		return runStopCommand(state, args[1:])
	case "tui":
		return runTUICommand(state, args[1:])
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
	all       bool
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
		case arg == "--workspace" || arg == "-w":
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
		case arg == "--all":
			flags.all = true
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
	fmt.Fprintln(w, "  ropcode                              overview of the project / workspace at $PWD")
	fmt.Fprintln(w, "  ropcode send [<workspace>] --prompt <text> [--model <m>] [--fresh] [--wait]")
	fmt.Fprintln(w, "  ropcode status [<workspace>] [--all]")
	fmt.Fprintln(w, "  ropcode logs   [<workspace>] [--follow]")
	fmt.Fprintln(w, "  ropcode stop   [<workspace>]")
	fmt.Fprintln(w, "  ropcode list   <instances|projects|workspaces|sessions>")
	fmt.Fprintln(w, "  ropcode tui")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Workspace target precedence (highest first):")
	fmt.Fprintln(w, "  1. --cwd <path>")
	fmt.Fprintln(w, "  2. <workspace> positional / -w <name>")
	fmt.Fprintln(w, "  3. $PWD inside a registered workspace dir")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "$PWD roles:")
	fmt.Fprintln(w, "  inside a workspace dir   → bare commands target that workspace")
	fmt.Fprintln(w, "  inside the project root  → bare `ropcode` lists every sub-workspace;")
	fmt.Fprintln(w, "                              action commands need <workspace> or --all where applicable")
	fmt.Fprintln(w, "  outside any project      → pass --cwd <path> or run from a project dir")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Global flags:")
	fmt.Fprintln(w, "  --instance <id>     pick a specific ropcode instance (auto if only one alive)")
	fmt.Fprintln(w, "  --project <name>    project name or path (disambiguate workspace lookup)")
	fmt.Fprintln(w, "  -w, --workspace <name>")
	fmt.Fprintln(w, "  --cwd <path>        explicit workspace path (overrides $PWD)")
	fmt.Fprintln(w, "  --all               in project root, act on every sub-workspace")
}
