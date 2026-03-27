package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"

	"ropcode/internal/config"
)

type tuiContextSummary struct {
	ProjectName       string
	ProjectSource     string
	ProjectPath       string
	WorkspaceName     string
	WorkspaceSource   string
	CWD               string
	SelectedSessionID string
}

type tuiViewOptions struct {
	writer            io.Writer
	client            rpcSession
	instanceID        string
	instanceSource    string
	wsURL             string
	contextSummary    tuiContextSummary
	interactive       bool
	selectedSessionID string
}

type tuiView struct {
	writer         io.Writer
	client         rpcSession
	instanceID     string
	instanceSource string
	wsURL          string
	contextSummary tuiContextSummary
	interactive    bool

	mu                sync.Mutex
	selectedSessionID string
}

func runTUICommand(state cliState, args []string) error {
	if len(args) != 0 {
		return errors.New("usage: ropcode tui")
	}

	cfg, err := state.deps.loadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	record, source, err := resolveInstance(state.deps, cfg, state.instanceFlag)
	if err != nil {
		return err
	}

	client, err := state.deps.dialRPC(instanceWSURL(record), record.AuthKey)
	if err != nil {
		return fmt.Errorf("attach to instance %s: %w", record.ID, err)
	}
	defer client.Close()

	summary := resolveTUIContextSummary(state, cfg)
	view := newTUIView(tuiViewOptions{
		writer:            state.stdout,
		client:            client,
		instanceID:        record.ID,
		instanceSource:    source,
		wsURL:             instanceWSURL(record),
		contextSummary:    summary,
		interactive:       isInteractiveWriter(state.stdout),
		selectedSessionID: summary.SelectedSessionID,
	})
	view.subscribeToEvents()
	if err := view.Refresh(); err != nil {
		return err
	}
	if !view.interactive {
		return nil
	}
	return view.waitForInterrupt()
}

func resolveTUIContextSummary(state cliState, cfg *config.Config) tuiContextSummary {
	summary := tuiContextSummary{}

	project, projectSource, projectErr := resolveProject(state.deps, cfg, projectResolutionOptions{
		explicitProject: state.projectFlag,
		explicitCWD:     state.cwdFlag,
	})
	if projectErr == nil {
		summary.ProjectName = project.Name
		summary.ProjectSource = projectSource
		summary.ProjectPath = projectPrimaryPath(project)
	}

	workspace, workspaceSource, workspaceErr := resolveWorkspace(state.deps, cfg, project, workspaceResolutionOptions{
		explicitWorkspace: state.workspaceFlag,
		explicitCWD:       state.cwdFlag,
	})
	if workspaceErr == nil {
		summary.WorkspaceName = workspace.Name
		summary.WorkspaceSource = workspaceSource
		summary.CWD = workspacePrimaryPath(workspace)
	} else if summary.ProjectPath != "" {
		summary.CWD = summary.ProjectPath
	}

	ctx, err := loadCLIContext(cfg)
	if err == nil {
		summary.SelectedSessionID = ctx.CurrentSessionID
	}

	return summary
}

func newTUIView(opts tuiViewOptions) *tuiView {
	selectedSessionID := opts.selectedSessionID
	if selectedSessionID == "" {
		selectedSessionID = opts.contextSummary.SelectedSessionID
	}
	return &tuiView{
		writer:            opts.writer,
		client:            opts.client,
		instanceID:        opts.instanceID,
		instanceSource:    opts.instanceSource,
		wsURL:             opts.wsURL,
		contextSummary:    opts.contextSummary,
		interactive:       opts.interactive,
		selectedSessionID: selectedSessionID,
	}
}

func (v *tuiView) subscribeToEvents() {
	handler := func(payload json.RawMessage) {
		decoded, ok := decodePayloadValue(payload)
		if !ok || payloadSessionID(decoded) == "" {
			return
		}
		_ = v.Refresh()
	}
	v.client.OnEvent("claude-output", handler)
	v.client.OnEvent("claude-error", handler)
	v.client.OnEvent("claude-complete", handler)
}

func (v *tuiView) Refresh() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	sessions, err := v.listSessions()
	if err != nil {
		return err
	}
	v.ensureSelection(sessions)

	var output string
	if v.selectedSessionID != "" {
		if err := v.client.Call("GetProviderSessionOutput", []any{v.selectedSessionID}, &output); err != nil {
			return err
		}
	}

	return v.render(sessions, output)
}

func (v *tuiView) listSessions() ([]liveProviderSession, error) {
	var sessions []liveProviderSession
	if err := v.client.Call("ListRunningProviderSessions", nil, &sessions); err != nil {
		return nil, err
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.After(sessions[j].StartedAt)
	})
	return sessions, nil
}

func (v *tuiView) ensureSelection(sessions []liveProviderSession) {
	if len(sessions) == 0 {
		v.selectedSessionID = ""
		return
	}
	for _, session := range sessions {
		if session.SessionID == v.selectedSessionID {
			return
		}
	}
	v.selectedSessionID = sessions[0].SessionID
}

func (v *tuiView) render(sessions []liveProviderSession, output string) error {
	var screen strings.Builder
	if v.interactive {
		screen.WriteString("\x1b[H\x1b[2J")
	}

	screen.WriteString("ropcode tui\n\n")
	screen.WriteString("Instance\n")
	fmt.Fprintf(&screen, "  id: %s\n", v.instanceID)
	fmt.Fprintf(&screen, "  source: %s\n", v.instanceSource)
	fmt.Fprintf(&screen, "  url: %s\n", v.wsURL)
	fmt.Fprintf(&screen, "  status: attached\n")

	screen.WriteString("\nContext\n")
	v.writeSummaryLine(&screen, "project", v.contextSummary.ProjectName)
	v.writeSummaryLine(&screen, "project_source", v.contextSummary.ProjectSource)
	v.writeSummaryLine(&screen, "project_path", v.contextSummary.ProjectPath)
	v.writeSummaryLine(&screen, "workspace", v.contextSummary.WorkspaceName)
	v.writeSummaryLine(&screen, "workspace_source", v.contextSummary.WorkspaceSource)
	v.writeSummaryLine(&screen, "cwd", v.contextSummary.CWD)

	screen.WriteString("\nRunning sessions\n")
	if len(sessions) == 0 {
		screen.WriteString("  no running sessions found\n")
	} else {
		screen.WriteString("  SESSION\tPROVIDER\tSTATUS\tCWD\tMODEL\n")
		for _, session := range sessions {
			prefix := " "
			if session.SessionID == v.selectedSessionID {
				prefix = "*"
			}
			fmt.Fprintf(&screen, "%s %s\t%s\t%s\t%s\t%s\n", prefix, session.SessionID, session.Provider, session.Status, session.ProjectPath, session.Model)
		}
	}

	screen.WriteString("\nSelected session\n")
	if v.selectedSessionID == "" {
		screen.WriteString("  none\n")
	} else {
		fmt.Fprintf(&screen, "  id: %s\n", v.selectedSessionID)
		screen.WriteString("  output:\n")
		var renderedOutput strings.Builder
		renderOutputBuffer(&renderedOutput, output)
		lines := strings.Split(strings.TrimSuffix(renderedOutput.String(), "\n"), "\n")
		if len(lines) == 1 && lines[0] == "" {
			lines = nil
		}
		if len(lines) == 0 {
			screen.WriteString("    (empty)\n")
		} else {
			for _, line := range lines {
				fmt.Fprintf(&screen, "    %s\n", line)
			}
		}
	}

	_, err := io.WriteString(v.writer, screen.String())
	return err
}

func (v *tuiView) writeSummaryLine(screen *strings.Builder, label string, value string) {
	if value == "" {
		return
	}
	fmt.Fprintf(screen, "  %s: %s\n", label, value)
}

func (v *tuiView) waitForInterrupt() error {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	<-sigCh
	return nil
}

func isInteractiveWriter(w io.Writer) bool {
	file, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}
