package main

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ropcode/internal/config"
	"ropcode/internal/database"
	appRuntime "ropcode/internal/runtime"
)

const staleGracePeriod = 90 * time.Second

type projectResolutionOptions struct {
	explicitProject string
	explicitCWD     string
}

type workspaceResolutionOptions struct {
	explicitWorkspace string
	explicitCWD       string
}

// resolvePWDContext inspects the current working directory and tags the cliState
// with one of three roles:
//   inside_workspace : pwd lies inside a registered workspace path
//   project_root     : pwd lies inside a project path but no workspace
//   outside          : neither
// The resolver is best-effort: any failure leaves the role at unset and the
// commands fall back to their explicit-flag behavior.
func resolvePWDContext(state *cliState) {
	if state.deps.getwd == nil {
		return
	}
	pwd, err := state.deps.getwd()
	if err != nil || pwd == "" {
		return
	}
	state.pwd = pwd

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return
	}
	projects, err := listProjects(state.deps, cfg)
	if err != nil || len(projects) == 0 {
		state.pwdRole = pwdRoleOutside
		return
	}

	if proj := findProjectByWorkspacePath(projects, pwd); proj != nil {
		for i := range proj.Workspaces {
			ws := &proj.Workspaces[i]
			if pathMatchesOrContains(workspacePrimaryPath(ws), pwd) {
				state.pwdRole = pwdRoleInsideWorkspace
				state.pwdProj = proj
				state.pwdWS = ws
				return
			}
		}
	}
	if proj := findProjectByPath(projects, pwd); proj != nil {
		state.pwdRole = pwdRoleProjectRoot
		state.pwdProj = proj
		return
	}
	state.pwdRole = pwdRoleOutside
}

// effectiveCWD returns the cwd that action commands should target. Explicit
// --cwd wins; otherwise the resolved workspace path under pwd.
func (s cliState) effectiveCWD() string {
	if s.cwdFlag != "" {
		return s.cwdFlag
	}
	if s.pwdRole == pwdRoleInsideWorkspace && s.pwdWS != nil {
		return workspacePrimaryPath(s.pwdWS)
	}
	return ""
}

// resolveWorkspaceFromState picks a workspace given current state + an explicit
// -w/--workspace flag. Used by send/logs/stop/status when not in inside_workspace mode.
func (s cliState) resolveWorkspaceFromFlag() (*database.WorkspaceIndex, error) {
	if s.workspaceFlag == "" || s.pwdProj == nil {
		return nil, errors.New("need -w <name> when run from a project root")
	}
	ws := findWorkspaceByName(s.pwdProj.Workspaces, s.workspaceFlag)
	if ws == nil {
		return nil, fmt.Errorf("workspace %q not found in project %q", s.workspaceFlag, s.pwdProj.Name)
	}
	return ws, nil
}

func runOverviewCommand(state cliState) error {
	switch state.pwdRole {
	case pwdRoleInsideWorkspace:
		return runOverviewWorkspace(state)
	case pwdRoleProjectRoot:
		return runOverviewProjectRoot(state)
	}
	writeUsage(state.stdout)
	if state.pwdRole == pwdRoleOutside {
		fmt.Fprintln(state.stderr, "")
		fmt.Fprintln(state.stderr, "$PWD is not under a registered project; run `ropcode list projects` or pass --cwd")
	}
	return nil
}

func runOverviewWorkspace(state cliState) error {
	ws := state.pwdWS
	proj := state.pwdProj
	wsPath := workspacePrimaryPath(ws)

	fmt.Fprintf(state.stdout, "project    %s\t%s\n", proj.Name, projectPrimaryPath(proj))
	fmt.Fprintf(state.stdout, "workspace  %s\t%s\n", ws.Name, wsPath)
	if ws.Branch != "" {
		fmt.Fprintf(state.stdout, "branch     %s\n", ws.Branch)
	}

	client, err := dialResolvedInstance(state)
	if err != nil {
		fmt.Fprintln(state.stdout, "")
		fmt.Fprintf(state.stdout, "instance   (offline: %v)\n", err)
		writeWorkspaceHints(state.stdout, ws.Name)
		return nil
	}
	defer client.Close()

	sessions, err := liveSessionsForCWD(client, wsPath)
	if err != nil {
		return err
	}
	fmt.Fprintln(state.stdout, "")
	if len(sessions) == 0 {
		fmt.Fprintln(state.stdout, "session    idle")
	} else {
		fmt.Fprintln(state.stdout, "SESSION\tPROVIDER\tSTATUS\tMODEL")
		for _, s := range sessions {
			fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\n", s.SessionID, s.Provider, s.Status, s.Model)
		}
	}
	writeWorkspaceHints(state.stdout, ws.Name)
	return nil
}

func runOverviewProjectRoot(state cliState) error {
	proj := state.pwdProj
	fmt.Fprintf(state.stdout, "project    %s\t%s\n", proj.Name, projectPrimaryPath(proj))

	if len(proj.Workspaces) == 0 {
		fmt.Fprintln(state.stdout, "")
		fmt.Fprintln(state.stdout, "(no sub-workspaces; create one in the GUI or with `git worktree add`)")
		return nil
	}

	client, err := dialResolvedInstance(state)
	var allSessions []liveProviderSession
	if err == nil {
		defer client.Close()
		_ = client.Call("ListRunningProviderSessions", nil, &allSessions)
	}

	fmt.Fprintln(state.stdout, "")
	fmt.Fprintln(state.stdout, "WORKSPACE\tBRANCH\tSTATUS\tSESSION\tMODEL")
	for i := range proj.Workspaces {
		ws := &proj.Workspaces[i]
		wsPath := workspacePrimaryPath(ws)
		status, sessID, model := "idle", "—", "—"
		for _, s := range allSessions {
			if s.ProjectPath == wsPath {
				status = s.Status
				sessID = s.SessionID
				model = s.Model
				break
			}
		}
		branch := ws.Branch
		if branch == "" {
			branch = "—"
		}
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\t%s\t%s\n", ws.Name, branch, status, sessID, model)
	}

	if err != nil {
		fmt.Fprintln(state.stdout, "")
		fmt.Fprintf(state.stdout, "(instance offline: %v)\n", err)
	}

	fmt.Fprintln(state.stdout, "")
	fmt.Fprintln(state.stdout, "Hints:")
	fmt.Fprintln(state.stdout, "  ropcode send -w <ws> --prompt \"...\"     send to a sub-workspace")
	fmt.Fprintln(state.stdout, "  ropcode logs -w <ws> --follow             follow logs")
	fmt.Fprintln(state.stdout, "  ropcode status --all                      list all running sessions in this project")
	fmt.Fprintln(state.stdout, "  ropcode tui                               interactive view")
	return nil
}

func writeWorkspaceHints(w io.Writer, wsName string) {
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Hints:")
	fmt.Fprintln(w, "  ropcode send --prompt \"...\"        send to this workspace")
	fmt.Fprintln(w, "  ropcode logs --follow                follow this workspace's session")
	fmt.Fprintln(w, "  ropcode stop                          stop this workspace's session")
	fmt.Fprintf(w, "  ropcode -w <name>                     act on a sibling workspace (current: %s)\n", wsName)
}

func liveSessionsForCWD(client rpcSession, cwd string) ([]liveProviderSession, error) {
	var sessions []liveProviderSession
	if err := client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return nil, err
	}
	out := make([]liveProviderSession, 0, len(sessions))
	for _, s := range sessions {
		if s.ProjectPath == cwd {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].StartedAt.After(out[j].StartedAt)
	})
	return out, nil
}

func runListCommand(state cliState, args []string) error {
	if len(args) == 0 {
		writeListUsage(state.stderr)
		return errors.New("list <instances|projects|workspaces|sessions>")
	}
	if isHelpArg(args[0]) {
		writeListUsage(state.stdout)
		return nil
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	target, rest := args[0], args[1:]
	switch target {
	case "instances":
		if len(rest) != 0 {
			return errors.New("usage: ropcode list instances")
		}
		return runListInstances(state, cfg)
	case "projects":
		if len(rest) != 0 {
			return errors.New("usage: ropcode list projects")
		}
		return runListProjects(state, cfg)
	case "workspaces":
		if len(rest) != 0 {
			return errors.New("usage: ropcode list workspaces [--project <name-or-path>] [--cwd <path>]")
		}
		return runListWorkspaces(state, cfg)
	case "sessions":
		opts, err := parseSessionListArgs(rest, state.cwdFlag)
		if err != nil {
			return err
		}
		client, err := dialResolvedInstance(state)
		if err != nil {
			return err
		}
		defer client.Close()
		return runSessionList(state, client, opts, "no running sessions found")
	default:
		writeListUsage(state.stderr)
		return fmt.Errorf("unknown list target %q", target)
	}
}

func writeListUsage(w io.Writer) {
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ropcode list instances")
	fmt.Fprintln(w, "  ropcode list projects")
	fmt.Fprintln(w, "  ropcode list workspaces [--project <name-or-path>] [--cwd <path>]")
	fmt.Fprintln(w, "  ropcode list sessions [--cwd <path>] [--provider <name>]")
}

func runListInstances(state cliState, cfg *config.Config) error {
	instances, err := listAliveInstances(state.deps, cfg)
	if err != nil {
		return err
	}
	if len(instances) == 0 {
		fmt.Fprintln(state.stdout, "no alive instances found")
		return nil
	}
	currentID := state.instanceFlag
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

func runListProjects(state cliState, cfg *config.Config) error {
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

func runListWorkspaces(state cliState, cfg *config.Config) error {
	project, err := pickProjectForList(state, cfg)
	if err != nil {
		return err
	}
	if len(project.Workspaces) == 0 {
		fmt.Fprintf(state.stdout, "no workspaces found for project %s\n", project.Name)
		return nil
	}
	fmt.Fprintln(state.stdout, "WORKSPACE\tBRANCH\tPATH")
	for i := range project.Workspaces {
		ws := &project.Workspaces[i]
		branch := ws.Branch
		if branch == "" {
			branch = "—"
		}
		fmt.Fprintf(state.stdout, "%s\t%s\t%s\n", ws.Name, branch, workspacePrimaryPath(ws))
	}
	return nil
}

// pickProjectForList prefers the pwd-resolved project so users can run
// `ropcode list workspaces` from a project dir without --project.
func pickProjectForList(state cliState, cfg *config.Config) (*database.ProjectIndex, error) {
	if state.projectFlag == "" && state.cwdFlag == "" && state.pwdProj != nil {
		return state.pwdProj, nil
	}
	project, _, err := resolveProject(state.deps, cfg, projectResolutionOptions{
		explicitProject: state.projectFlag,
		explicitCWD:     state.cwdFlag,
	})
	return project, err
}

func dialResolvedInstance(state cliState) (rpcSession, error) {
	cfg, err := state.deps.loadConfig()
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}
	record, _, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return nil, err
	}
	client, err := state.deps.dialRPC(instanceWSURL(record), record.AuthKey)
	if err != nil {
		return nil, fmt.Errorf("attach to instance %s: %w", record.ID, err)
	}
	return client, nil
}

func resolveInstance(deps cliDeps, cfg *config.Config, explicitID string) (*database.InstanceRecord, string, error) {
	alive, err := listAliveInstances(deps, cfg)
	if err != nil {
		return nil, "", err
	}

	if explicitID != "" {
		record := findInstanceByID(alive, explicitID)
		if record == nil {
			return nil, "", fmt.Errorf("instance %q is not alive; run `ropcode list instances`", explicitID)
		}
		return record, "explicit", nil
	}

	if len(alive) == 1 {
		return alive[0], "auto", nil
	}
	if len(alive) == 0 {
		return nil, "", errors.New("no alive instances found; start ropcode and run `ropcode list instances`")
	}
	return nil, "", errors.New("multiple alive instances found; pass `--instance <id>` or run `ropcode list instances`")
}

func resolveProject(deps cliDeps, cfg *config.Config, opts projectResolutionOptions) (*database.ProjectIndex, string, error) {
	projects, err := listProjects(deps, cfg)
	if err != nil {
		return nil, "", err
	}
	if len(projects) == 0 {
		return nil, "", errors.New("no projects found; run `ropcode list projects`")
	}

	if opts.explicitCWD != "" {
		if project := findProjectByWorkspacePath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		if project := findProjectByPath(projects, opts.explicitCWD); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project for cwd %q not found; run `ropcode list projects`", opts.explicitCWD)
	}
	if opts.explicitProject != "" {
		if project := findProject(projects, opts.explicitProject); project != nil {
			return project, "explicit", nil
		}
		return nil, "", fmt.Errorf("project %q not found; run `ropcode list projects`", opts.explicitProject)
	}

	if len(projects) == 1 {
		return projects[0], "auto", nil
	}
	return nil, "", errors.New("multiple projects found; use `--project <name-or-path>` or `--cwd <path>` or run `ropcode list projects`")
}

func resolveWorkspace(deps cliDeps, cfg *config.Config, project *database.ProjectIndex, opts workspaceResolutionOptions) (*database.WorkspaceIndex, string, error) {
	if project == nil {
		return nil, "", errors.New("project context required before resolving workspace")
	}
	workspaces := project.Workspaces
	if len(workspaces) == 0 {
		return nil, "", fmt.Errorf("project %q has no indexed workspaces; run `ropcode list workspaces --project %s`", project.Name, project.Name)
	}

	if opts.explicitCWD != "" {
		if workspace := findWorkspaceByPath(workspaces, opts.explicitCWD); workspace != nil {
			return workspace, "explicit", nil
		}
	}
	if opts.explicitWorkspace != "" {
		if workspace := findWorkspaceByName(workspaces, opts.explicitWorkspace); workspace != nil {
			return workspace, "explicit", nil
		}
		return nil, "", fmt.Errorf("workspace %q not found in project %q; run `ropcode list workspaces --project %s`", opts.explicitWorkspace, project.Name, project.Name)
	}

	if len(workspaces) == 1 {
		return &workspaces[0], "auto", nil
	}
	return nil, "", fmt.Errorf("multiple workspaces found for project %q; use `--workspace <name>` or `--cwd <path>` or run `ropcode list workspaces --project %s`", project.Name, project.Name)
}

func listAliveInstances(deps cliDeps, cfg *config.Config) ([]*database.InstanceRecord, error) {
	db, err := deps.openDB(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	registry := appRuntime.NewRegistry(db)
	cutoff := deps.now().Add(-staleGracePeriod).UnixMilli()
	instances, err := registry.ListAliveInstances(cutoff)
	if err != nil {
		return nil, fmt.Errorf("list alive instances: %w", err)
	}
	return instances, nil
}

func listProjects(deps cliDeps, cfg *config.Config) ([]*database.ProjectIndex, error) {
	db, err := deps.openDB(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	projects, err := db.GetAllProjectIndexes()
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].Name < projects[j].Name
	})
	return projects, nil
}

func findInstanceByID(instances []*database.InstanceRecord, id string) *database.InstanceRecord {
	for _, inst := range instances {
		if inst.ID == id {
			return inst
		}
	}
	return nil
}

func pathMatchesOrContains(basePath, candidate string) bool {
	if basePath == "" || candidate == "" {
		return false
	}
	cleanBase := filepath.Clean(basePath)
	cleanCandidate := filepath.Clean(candidate)
	if cleanBase == cleanCandidate {
		return true
	}
	rel, err := filepath.Rel(cleanBase, cleanCandidate)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func findProject(projects []*database.ProjectIndex, nameOrPath string) *database.ProjectIndex {
	for _, project := range projects {
		if project.Name == nameOrPath || projectPrimaryPath(project) == nameOrPath {
			return project
		}
	}
	return nil
}

func findProjectByPath(projects []*database.ProjectIndex, path string) *database.ProjectIndex {
	for _, project := range projects {
		if pathMatchesOrContains(projectPrimaryPath(project), path) {
			return project
		}
	}
	return nil
}

func findProjectByWorkspacePath(projects []*database.ProjectIndex, path string) *database.ProjectIndex {
	for _, project := range projects {
		for i := range project.Workspaces {
			if pathMatchesOrContains(workspacePrimaryPath(&project.Workspaces[i]), path) {
				return project
			}
		}
	}
	return nil
}

func findWorkspaceByName(workspaces []database.WorkspaceIndex, name string) *database.WorkspaceIndex {
	for i := range workspaces {
		if workspaces[i].Name == name {
			return &workspaces[i]
		}
	}
	return nil
}

func findWorkspaceByPath(workspaces []database.WorkspaceIndex, path string) *database.WorkspaceIndex {
	for i := range workspaces {
		if pathMatchesOrContains(workspacePrimaryPath(&workspaces[i]), path) {
			return &workspaces[i]
		}
	}
	return nil
}

func projectPrimaryPath(project *database.ProjectIndex) string {
	if project == nil || len(project.Providers) == 0 {
		return ""
	}
	return project.Providers[0].Path
}

func workspacePrimaryPath(workspace *database.WorkspaceIndex) string {
	if workspace == nil || len(workspace.Providers) == 0 {
		return ""
	}
	return workspace.Providers[0].Path
}

func instanceWSURL(record *database.InstanceRecord) string {
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("ws://%s:%d/ws", host, record.Port)
}
