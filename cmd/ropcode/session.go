package main

import (
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"ropcode/internal/database"
)

type liveProviderSession struct {
	SessionID   string    `json:"session_id"`
	ProjectPath string    `json:"project_path"`
	Model       string    `json:"model"`
	Status      string    `json:"status"`
	StartedAt   time.Time `json:"started_at"`
	PID         int       `json:"pid,omitempty"`
	Provider    string    `json:"provider"`
}

type sessionCommandOptions struct {
	cwd           string
	provider      string
	prompt        string
	model         string
	providerAPIID string
	sessionID     string
	follow        bool
	fresh         bool
	wait          bool
	create        bool
}

func runSendCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeSendUsage(state.stdout)
		return nil
	}
	state, args, err := adoptPositionalArg(state, args)
	if err != nil {
		return err
	}
	opts, err := parseSessionSendArgs(args, "")
	if err != nil {
		return err
	}
	if opts.create {
		created, err := createWorkspaceForSend(state, opts)
		if err != nil {
			return err
		}
		opts.cwd = created
	} else {
		cwd, err := resolveActionCWD(state)
		if err != nil {
			return err
		}
		if cwd == "" {
			if cwd, err = actionCWDOrError(state, "send"); err != nil {
				return err
			}
		}
		opts.cwd = cwd
	}
	client, err := dialResolvedInstance(state)
	if err != nil {
		return err
	}
	defer client.Close()
	return runSessionSend(state, client, opts)
}

// createWorkspaceForSend handles the --create path: validates inputs, picks a
// parent project, calls the server's CreateWorkspace RPC, and returns the path
// of the newly-created workspace so runSessionSend can target it.
func createWorkspaceForSend(state cliState, opts sessionCommandOptions) (string, error) {
	if state.cwdFlag != "" {
		return "", errors.New("--create cannot be combined with --cwd; pass a workspace name instead (e.g. `ropcode send feat-x --create --prompt ...`)")
	}
	if state.workspaceFlag == "" {
		return "", errors.New("--create needs a workspace name (e.g. `ropcode send feat-x --create --prompt \"...\"`)")
	}

	parent, err := resolveCreateParent(state)
	if err != nil {
		return "", err
	}
	if existing := findWorkspaceByName(parent.Workspaces, state.workspaceFlag); existing != nil {
		return "", fmt.Errorf("workspace %q already exists in project %q; drop --create to send to it", state.workspaceFlag, parent.Name)
	}

	client, err := dialResolvedInstance(state)
	if err != nil {
		return "", fmt.Errorf("create workspace: %w", err)
	}
	defer client.Close()

	// branch == name: ropcode treats sub-workspace name and its git branch as one identifier.
	if err := client.Call("CreateWorkspace", []any{projectPrimaryPath(parent), state.workspaceFlag, state.workspaceFlag}, nil); err != nil {
		return "", fmt.Errorf("create workspace: %w", err)
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return "", fmt.Errorf("load config: %w", err)
	}
	projects, err := listProjects(state.deps, cfg)
	if err != nil {
		return "", err
	}
	for i := range projects {
		if projects[i].Name != parent.Name {
			continue
		}
		if ws := findWorkspaceByName(projects[i].Workspaces, state.workspaceFlag); ws != nil {
			fmt.Fprintf(state.stdout, "created\t%s\t%s\n", ws.Name, workspacePrimaryPath(ws))
			return workspacePrimaryPath(ws), nil
		}
	}
	return "", fmt.Errorf("workspace %q created but not yet indexed; retry in a moment", state.workspaceFlag)
}

// resolveCreateParent returns the project the new workspace will live under.
// Priority: pwd-resolved project → --project flag → error.
func resolveCreateParent(state cliState) (*database.ProjectIndex, error) {
	if state.pwdProj != nil {
		return state.pwdProj, nil
	}
	if state.projectFlag == "" {
		return nil, errors.New("--create needs a parent project: cd into one or pass --project <name>")
	}
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}
	proj, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{explicitProject: state.projectFlag})
	return proj, err
}

func runStatusCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeStatusUsage(state.stdout)
		return nil
	}
	state, args, err := adoptPositionalArg(state, args)
	if err != nil {
		return err
	}
	opts, err := parseSessionListArgs(args, "")
	if err != nil {
		return err
	}
	cwd, err := resolveActionCWD(state)
	if err != nil {
		return err
	}
	opts.cwd = cwd
	if state.allFlag {
		opts.cwd = ""
	} else if opts.cwd == "" && state.pwdRole == pwdRoleProjectRoot {
		client, err := dialResolvedInstance(state)
		if err != nil {
			return err
		}
		defer client.Close()
		return runProjectStatus(state, client, opts)
	} else if opts.cwd == "" {
		if opts.cwd, err = actionCWDOrError(state, "status"); err != nil {
			return err
		}
	}
	client, err := dialResolvedInstance(state)
	if err != nil {
		return err
	}
	defer client.Close()
	return runSessionList(state, client, opts, "idle")
}

func runLogsCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeLogsUsage(state.stdout)
		return nil
	}
	state, args, err := adoptPositionalArg(state, args)
	if err != nil {
		return err
	}
	opts, err := parseSessionLogsArgs(args, "")
	if err != nil {
		return err
	}
	if opts.sessionID == "" {
		cwd, err := resolveActionCWD(state)
		if err != nil {
			return err
		}
		if cwd == "" {
			if cwd, err = actionCWDOrError(state, "logs"); err != nil {
				return err
			}
		}
		opts.cwd = cwd
	}
	client, err := dialResolvedInstance(state)
	if err != nil {
		return err
	}
	defer client.Close()
	return runSessionLogs(state, client, opts)
}

func runStopCommand(state cliState, args []string) error {
	if len(args) == 1 && isHelpArg(args[0]) {
		writeStopUsage(state.stdout)
		return nil
	}
	state, args, err := adoptPositionalArg(state, args)
	if err != nil {
		return err
	}
	opts, err := parseSessionStopArgs(args, "")
	if err != nil {
		return err
	}
	if opts.sessionID == "" {
		cwd, err := resolveActionCWD(state)
		if err != nil {
			return err
		}
		if cwd == "" {
			if cwd, err = actionCWDOrError(state, "stop"); err != nil {
				return err
			}
		}
		opts.cwd = cwd
	}
	client, err := dialResolvedInstance(state)
	if err != nil {
		return err
	}
	defer client.Close()
	return runSessionStop(state, client, opts)
}

// adoptPositionalArg pulls a single non-flag positional into state.workspaceFlag.
// Errors if the user gave both a positional and -w with different names.
func adoptPositionalArg(state cliState, args []string) (cliState, []string, error) {
	args, posWS, err := extractPositionalWorkspace(args)
	if err != nil {
		return state, nil, err
	}
	state, err = adoptPositionalWorkspace(state, posWS)
	return state, args, err
}

// extractPositionalWorkspace pulls a single non-flag arg out of args. Treats the
// known value-bearing action-local flags (--prompt, --provider, --model,
// --provider-api-id, --session) as consuming their value. Global flags are
// already gone by the time we get here. More than one positional → error.
func extractPositionalWorkspace(args []string) ([]string, string, error) {
	valueFlags := map[string]bool{
		"--provider":        true,
		"--prompt":          true,
		"--model":           true,
		"--provider-api-id": true,
		"--session":         true,
	}
	cleaned := make([]string, 0, len(args))
	ws := ""
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") {
			cleaned = append(cleaned, a)
			if valueFlags[a] && i+1 < len(args) {
				cleaned = append(cleaned, args[i+1])
				i++
			}
			continue
		}
		if ws != "" {
			return nil, "", fmt.Errorf("unexpected extra argument %q (workspace already %q)", a, ws)
		}
		ws = a
	}
	return cleaned, ws, nil
}

// adoptPositionalWorkspace merges a positional workspace name into state.
// Conflicts with -w/--workspace if the names differ.
func adoptPositionalWorkspace(state cliState, posWS string) (cliState, error) {
	if posWS == "" {
		return state, nil
	}
	if state.workspaceFlag != "" && state.workspaceFlag != posWS {
		return state, fmt.Errorf("workspace given twice: -w %q and positional %q", state.workspaceFlag, posWS)
	}
	state.workspaceFlag = posWS
	return state, nil
}

// resolveActionCWD picks the cwd that an action command should target.
// Priority: --cwd flag > -w/positional (pwd's project, then global search) > pwd-resolved workspace.
// Returns ("", nil) when nothing resolves; the caller decides if that's an error.
func resolveActionCWD(state cliState) (string, error) {
	if state.cwdFlag != "" {
		return state.cwdFlag, nil
	}
	if state.workspaceFlag != "" {
		if state.pwdProj != nil {
			if ws := findWorkspaceByName(state.pwdProj.Workspaces, state.workspaceFlag); ws != nil {
				return workspacePrimaryPath(ws), nil
			}
		}
		return findWorkspacePathByName(state, state.workspaceFlag, state.projectFlag)
	}
	return state.effectiveCWD(), nil
}

// findWorkspacePathByName scans every project (or those matching projectFilter
// by name/path) for a workspace whose Name == wsName. Errors clearly when not
// found or ambiguous.
func findWorkspacePathByName(state cliState, wsName, projectFilter string) (string, error) {
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return "", fmt.Errorf("load config: %w", err)
	}
	projects, err := listProjects(state.deps, cfg)
	if err != nil {
		return "", err
	}
	type hit struct {
		project string
		path    string
	}
	var matches []hit
	for i := range projects {
		p := projects[i]
		if projectFilter != "" && p.Name != projectFilter && projectPrimaryPath(p) != projectFilter {
			continue
		}
		for j := range p.Workspaces {
			if p.Workspaces[j].Name == wsName {
				matches = append(matches, hit{p.Name, workspacePrimaryPath(&p.Workspaces[j])})
			}
		}
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("workspace %q not found; pass --create to make it, or run `ropcode list workspaces`", wsName)
	}
	if len(matches) > 1 {
		names := make([]string, 0, len(matches))
		for _, m := range matches {
			names = append(names, m.project)
		}
		return "", fmt.Errorf("workspace %q exists in multiple projects (%s); pass --project <name>", wsName, strings.Join(names, ", "))
	}
	return matches[0].path, nil
}

// actionCWDOrError builds a friendly error when no target workspace was given
// and no pwd-resolved workspace exists. Called only after resolveActionCWD
// returned ("", nil).
func actionCWDOrError(state cliState, command string) (string, error) {
	switch state.pwdRole {
	case pwdRoleProjectRoot:
		return "", fmt.Errorf("`ropcode %s` from a project root needs a workspace name (e.g. `ropcode %s ws-a` or `-w ws-a`); see `ropcode list workspaces`", command, command)
	case pwdRoleOutside:
		return "", fmt.Errorf("`ropcode %s` needs a workspace name or --cwd (e.g. `ropcode %s ws-a`); see `ropcode list workspaces`", command, command)
	default:
		return "", fmt.Errorf("`ropcode %s` needs a workspace name, --cwd, or to be run from a workspace dir", command)
	}
}

// runProjectStatus lists sessions filtered to workspaces of the pwd-resolved project.
func runProjectStatus(state cliState, client rpcSession, opts sessionCommandOptions) error {
	var all []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &all); err != nil {
		return err
	}
	wsPaths := map[string]string{}
	for i := range state.pwdProj.Workspaces {
		ws := &state.pwdProj.Workspaces[i]
		if p := workspacePrimaryPath(ws); p != "" {
			wsPaths[p] = ws.Name
		}
	}
	filtered := make([]liveProviderSession, 0, len(all))
	for _, s := range all {
		if _, ok := wsPaths[s.ProjectPath]; !ok {
			continue
		}
		if opts.provider != "" && s.Provider != opts.provider {
			continue
		}
		filtered = append(filtered, s)
	}
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].StartedAt.After(filtered[j].StartedAt)
	})
	if len(filtered) == 0 {
		fmt.Fprintln(state.stdout, "idle")
		return nil
	}
	fmt.Fprintln(state.stdout, "WORKSPACE\tSESSION\tPROVIDER\tSTATUS\tMODEL")
	for _, s := range filtered {
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\t%s\n", wsPaths[s.ProjectPath], s.SessionID, s.Provider, s.Status, s.Model)
	}
	return nil
}

func writeSendUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode send [<workspace>] --prompt <text> [--model <m>] [--session <id>] [--fresh] [--wait]")
	fmt.Fprintln(w, "  ropcode send <workspace> --create --prompt <text> [...]")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Continues an existing running session in the workspace, or starts a new one if none is running.")
	fmt.Fprintln(w, "Workspace target precedence: --cwd > <workspace>|-w > $PWD-resolved workspace.")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "--create   create the workspace before sending; <workspace> is also the git branch")
	fmt.Fprintln(w, "           parent project = $PWD project, or --project <name>")
	fmt.Fprintln(w, "--fresh    force a new session (stop the current one)")
	fmt.Fprintln(w, "--wait     block until the AI finishes the turn")
}

func writeStatusUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode status [<workspace>] [--all]")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "From a workspace dir: shows that workspace's sessions ('idle' if none).")
	fmt.Fprintln(w, "From a project root:  shows running sessions in every sub-workspace.")
	fmt.Fprintln(w, "--all bypasses pwd filtering and lists every session on the instance.")
}

func writeLogsUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode logs [<workspace>] [--follow]")
	fmt.Fprintln(w, "  ropcode logs --session <id> [--follow]")
}

func writeStopUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode stop [<workspace>]")
	fmt.Fprintln(w, "  ropcode stop --session <id>")
}

func runSessionSend(state cliState, client rpcSession, opts sessionCommandOptions) error {
	resumeSessionID := ""
	if opts.fresh {
		resumeSessionID = "__ROP_FRESH_SESSION__"
	}

	if opts.providerAPIID == "" {
		opts.providerAPIID = resolveProviderAPIID(state, client, opts.cwd, opts.provider)
	}

	var stream *sessionEventStream
	if opts.wait {
		stream = subscribeSessionEvents(client, state.stdout, state.stderr, "", opts.cwd)
	}

	var sessionID string
	if err := client.Call("StartInteractiveClaudeSession", []any{opts.cwd, opts.model, opts.providerAPIID, resumeSessionID}, &sessionID); err != nil {
		return fmt.Errorf("start interactive session: %w", err)
	}

	if err := client.Call("SendClaudeMessage", []any{opts.cwd, sessionID, opts.prompt}, nil); err != nil {
		return fmt.Errorf("send message: %w", err)
	}

	if !opts.wait {
		fmt.Fprintln(state.stdout, "ok")
		return nil
	}
	stream.setSessionID(sessionID)
	return stream.wait()
}

// resolveProviderAPIID asks the server for the API config the GUI would have
// used: project-scoped if set, otherwise the provider's default. Returns "" on
// failure or when no config is registered — the server treats that as "use the
// CLI's built-in default", which is the right behavior for users who never set
// up a custom endpoint.
func resolveProviderAPIID(state cliState, client rpcSession, cwd, provider string) string {
	if cwd == "" || provider == "" {
		return ""
	}
	var cfg struct {
		ID string `json:"id"`
	}
	if err := client.Call("GetProjectProviderApiConfig", []any{cwd, provider}, &cfg); err != nil {
		fmt.Fprintf(state.stderr, "warning: could not resolve provider api config (%v); using server default\n", err)
		return ""
	}
	return cfg.ID
}

func runSessionList(state cliState, client rpcSession, opts sessionCommandOptions, emptyMessage string) error {
	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return err
	}

	filtered := make([]liveProviderSession, 0, len(sessions))
	for _, session := range sessions {
		if opts.provider != "" && session.Provider != opts.provider {
			continue
		}
		if opts.cwd != "" && session.ProjectPath != opts.cwd {
			continue
		}
		filtered = append(filtered, session)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].StartedAt.After(filtered[j].StartedAt)
	})

	if len(filtered) == 0 {
		fmt.Fprintln(state.stdout, emptyMessage)
		return nil
	}

	fmt.Fprintln(state.stdout, "SESSION\tPROVIDER\tSTATUS\tCWD\tMODEL")
	for _, session := range filtered {
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\t%s\n", session.SessionID, session.Provider, session.Status, session.ProjectPath, session.Model)
	}
	return nil
}

func runSessionLogs(state cliState, client rpcSession, opts sessionCommandOptions) error {
	if opts.sessionID == "" && opts.cwd != "" {
		resolved, err := latestSessionForCWD(client, opts.cwd)
		if err != nil {
			return err
		}
		opts.sessionID = resolved
	}
	stream := subscribeSessionEvents(client, state.stdout, state.stderr, opts.sessionID, opts.cwd)

	var output string
	if err := client.Call("GetProviderSessionOutput", []any{opts.sessionID}, &output); err != nil {
		return err
	}
	renderOutputBuffer(state.stdout, output)
	if !opts.follow {
		return nil
	}

	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return err
	}
	for _, session := range sessions {
		if session.SessionID == opts.sessionID {
			return stream.wait()
		}
	}

	var latest string
	if err := client.Call("GetProviderSessionOutput", []any{opts.sessionID}, &latest); err != nil {
		return err
	}
	if latest != output {
		renderOutputBuffer(state.stdout, latest[len(output):])
	}
	return nil
}

func runSessionStop(state cliState, client rpcSession, opts sessionCommandOptions) error {
	if opts.sessionID == "" && opts.cwd != "" {
		resolved, err := latestSessionForCWD(client, opts.cwd)
		if err != nil {
			return err
		}
		opts.sessionID = resolved
	}
	if err := client.Call("StopProviderSession", []any{opts.sessionID}, nil); err != nil {
		return err
	}
	fmt.Fprintf(state.stdout, "stopped\t%s\n", opts.sessionID)
	return nil
}

func latestSessionForCWD(client rpcSession, cwd string) (string, error) {
	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return "", err
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.After(sessions[j].StartedAt)
	})
	for _, s := range sessions {
		if s.ProjectPath == cwd {
			return s.SessionID, nil
		}
	}
	return "", fmt.Errorf("no running session found for --cwd %s", cwd)
}

func parseSessionSendArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	if opts.provider == "" {
		opts.provider = "claude"
	}
	if opts.prompt == "" {
		return sessionCommandOptions{}, errors.New("usage: ropcode send [-w <name>] --prompt <text>")
	}
	return opts, nil
}

func parseSessionListArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	return opts, nil
}

func parseSessionLogsArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	return opts, nil
}

func parseSessionStopArgs(args []string, fallbackCWD string) (sessionCommandOptions, error) {
	opts, err := parseSessionFlagPairs(args)
	if err != nil {
		return sessionCommandOptions{}, err
	}
	if opts.cwd == "" {
		opts.cwd = fallbackCWD
	}
	return opts, nil
}

func parseSessionFlagPairs(args []string) (sessionCommandOptions, error) {
	var opts sessionCommandOptions
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--cwd":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.cwd = value
			i = next
		case "--provider":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.provider = value
			i = next
		case "--prompt":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.prompt = value
			i = next
		case "--model":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.model = value
			i = next
		case "--provider-api-id":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.providerAPIID = value
			i = next
		case "--session":
			value, next, err := requireFlagValue(args, i)
			if err != nil {
				return sessionCommandOptions{}, err
			}
			opts.sessionID = value
			i = next
		case "--follow":
			opts.follow = true
		case "--fresh":
			opts.fresh = true
		case "--wait":
			opts.wait = true
		case "--create":
			opts.create = true
		default:
			return sessionCommandOptions{}, fmt.Errorf("unknown flag %q", args[i])
		}
	}
	return opts, nil
}

func requireFlagValue(args []string, index int) (string, int, error) {
	if index+1 >= len(args) {
		return "", index, fmt.Errorf("%s requires a value", args[index])
	}
	return args[index+1], index + 1, nil
}
