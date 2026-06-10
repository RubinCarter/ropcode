package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ropcode/internal/agentpacks"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/provider"
)

type agentPackScheduler struct {
	app      *App
	cancel   context.CancelFunc
	done     chan struct{}
	lastRuns map[string]struct{}
	sessions map[string]agentSessionSource
	mu       sync.Mutex
}

type agentSessionSource struct {
	PackID  string
	AgentID string
}

type agentPackTarget struct {
	Kind        string
	Path        string
	Name        string
	ProjectName string
}

func newAgentPackScheduler(app *App) *agentPackScheduler {
	return &agentPackScheduler{
		app:      app,
		done:     make(chan struct{}),
		lastRuns: make(map[string]struct{}),
		sessions: make(map[string]agentSessionSource),
	}
}

func (s *agentPackScheduler) Start(parent context.Context) {
	if s == nil || s.app == nil || s.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	go s.loop(ctx)
}

func (s *agentPackScheduler) Close() {
	if s == nil {
		return
	}
	if s.cancel != nil {
		s.cancel()
	}
	if s.done != nil {
		<-s.done
	}
}

func (s *agentPackScheduler) loop(ctx context.Context) {
	defer close(s.done)
	sub := s.app.eventHub.SubscribeDomain()
	defer sub.Close()

	s.evaluateSchedules(ctx, time.Now())
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			s.evaluateSchedules(ctx, now)
		case event, ok := <-sub.C:
			if !ok {
				return
			}
			s.handleDomainEvent(ctx, event)
		}
	}
}

func (s *agentPackScheduler) evaluateSchedules(ctx context.Context, now time.Time) {
	details, err := s.app.agentPackManager.ListInstalledDetails()
	if err != nil {
		log.Printf("[agent-packs] list installed details for schedule failed: %v", err)
		return
	}
	targets := s.allTargets()
	for _, detail := range details {
		for _, agent := range detail.Manifest.Agents {
			config, ok := detail.Install.Agents[agent.ID]
			if !ok || !config.Enabled {
				continue
			}
			for index, trigger := range config.Triggers {
				if !trigger.Enabled || triggerMode(trigger.Mode) != "schedule" {
					continue
				}
				if !cronMatches(trigger.Schedule, triggerTime(trigger, now)) {
					continue
				}
				for _, target := range targetsForScope(trigger.Scope, targets) {
					key := scheduleRunKey(detail.Manifest.ID, agent.ID, index, target.Path, triggerTime(trigger, now))
					if s.markRunSeen(key) {
						go s.runTrigger(ctx, detail, agent, config, trigger, target, nil)
					}
				}
			}
		}
	}
}

func (s *agentPackScheduler) handleDomainEvent(ctx context.Context, event eventhub.DomainEvent) {
	details, err := s.app.agentPackManager.ListInstalledDetails()
	if err != nil {
		log.Printf("[agent-packs] list installed details for event failed: %v", err)
		return
	}
	target, ok := s.targetForEvent(event)
	if !ok {
		return
	}
	for _, detail := range details {
		for _, agent := range detail.Manifest.Agents {
			config, ok := detail.Install.Agents[agent.ID]
			if !ok || !config.Enabled {
				continue
			}
			for _, trigger := range config.Triggers {
				if !trigger.Enabled || triggerMode(trigger.Mode) != "event" {
					continue
				}
				if !s.triggerMatchesEvent(trigger, detail.Manifest.ID, agent.ID, event) {
					continue
				}
				go s.runTrigger(ctx, detail, agent, config, trigger, target, &event)
			}
		}
	}
}

func (s *agentPackScheduler) targetForEvent(event eventhub.DomainEvent) (agentPackTarget, bool) {
	path := strings.TrimSpace(event.Scope.WorkspacePath)
	kind := "workspace"
	if path == "" {
		path = strings.TrimSpace(event.Scope.ProjectPath)
		kind = "project"
	}
	if path == "" {
		path = stringFromPayload(event.Payload, "workspace_path")
		kind = "workspace"
	}
	if path == "" {
		path = stringFromPayload(event.Payload, "project_path")
		kind = "project"
	}
	if path == "" {
		path = stringFromPayload(event.Payload, "path")
		kind = "workspace"
	}
	if path == "" {
		path = stringFromPayload(event.Payload, "cwd")
		kind = "workspace"
	}
	if strings.TrimSpace(path) == "" {
		return agentPackTarget{}, false
	}
	name := filepath.Base(filepath.Clean(path))
	return agentPackTarget{
		Kind: kind,
		Path: path,
		Name: defaultString(name, path),
	}, true
}

func (s *agentPackScheduler) triggerMatchesEvent(trigger agentpacks.TriggerConfig, packID, agentID string, event eventhub.DomainEvent) bool {
	if !eventMatches(triggerEventType(trigger), event.Type) {
		return false
	}
	if isAgentRunEvent(event.Type) {
		return s.agentRunMatchesTrigger(trigger, packID, agentID, event)
	}
	if !isSessionScopedEvent(event.Type) {
		return true
	}

	sessionSource := s.sessionSourceForEvent(event)
	triggerSessionType := strings.ToLower(strings.TrimSpace(trigger.SessionType))
	if triggerSessionType == "" {
		triggerSessionType = "user"
	}
	switch triggerSessionType {
	case "user":
		return !sessionSource.IsAgent
	case "agent":
		if !sessionSource.IsAgent {
			return false
		}
		if sessionSource.PackID == packID && sessionSource.AgentID == agentID {
			return false
		}
		wanted := strings.TrimSpace(trigger.SessionAgentID)
		if wanted == "" || strings.EqualFold(wanted, "any") || wanted == "*" {
			return true
		}
		return sessionSource.AgentID == wanted || sessionSource.PackID+"/"+sessionSource.AgentID == wanted
	default:
		return true
	}
}

func (s *agentPackScheduler) agentRunMatchesTrigger(trigger agentpacks.TriggerConfig, packID, agentID string, event eventhub.DomainEvent) bool {
	source := s.sessionSourceForEvent(event)
	if !source.IsAgent {
		return false
	}
	if source.PackID == packID && source.AgentID == agentID {
		return false
	}
	wanted := strings.TrimSpace(trigger.AgentID)
	if wanted == "" || strings.EqualFold(wanted, "any") || wanted == "*" {
		return true
	}
	return source.AgentID == wanted || source.PackID+"/"+source.AgentID == wanted
}

type eventSessionSource struct {
	IsAgent bool
	PackID  string
	AgentID string
}

func (s *agentPackScheduler) sessionSourceForEvent(event eventhub.DomainEvent) eventSessionSource {
	packID := stringFromPayload(event.Payload, "agent_pack_id")
	agentID := stringFromPayload(event.Payload, "pack_agent_id")
	if packID != "" || agentID != "" {
		return eventSessionSource{IsAgent: true, PackID: packID, AgentID: agentID}
	}
	sessionID := strings.TrimSpace(event.Scope.SessionID)
	if sessionID == "" {
		sessionID = stringFromPayload(event.Payload, "session_id")
	}
	if source, ok := s.automationSessionSource(sessionID); ok {
		return eventSessionSource{IsAgent: true, PackID: source.PackID, AgentID: source.AgentID}
	}
	if s.app != nil && s.app.dbManager != nil && sessionID != "" {
		if run, err := s.app.dbManager.GetAgentRunBySessionID(sessionID); err == nil && run != nil && run.AgentID == 0 {
			return eventSessionSource{IsAgent: true}
		}
	}
	return eventSessionSource{}
}

func (s *agentPackScheduler) runTrigger(ctx context.Context, detail agentpacks.InstalledPackDetail, agent agentpacks.AgentDefinition, config agentpacks.InstalledAgentConfig, trigger agentpacks.TriggerConfig, target agentPackTarget, event *eventhub.DomainEvent) {
	if ctx.Err() != nil {
		return
	}
	if _, err := s.startAgentPackRun(ctx, detail, agent, config, trigger, target, event); err != nil {
		log.Printf("[agent-packs] trigger run failed: %v", err)
	}
}

func (s *agentPackScheduler) startAgentPackRun(ctx context.Context, detail agentpacks.InstalledPackDetail, agent agentpacks.AgentDefinition, installConfig agentpacks.InstalledAgentConfig, trigger agentpacks.TriggerConfig, target agentPackTarget, domainEvent *eventhub.DomainEvent) (*database.AgentRun, error) {
	if s.app.dbManager == nil || s.app.providerManager == nil {
		return nil, fmt.Errorf("agent pack runner is not initialized")
	}
	runtime := installConfig.Runtime
	if strings.TrimSpace(runtime.Provider) == "" {
		return nil, fmt.Errorf("agent %s has no runtime provider", agent.ID)
	}
	if strings.TrimSpace(runtime.Model) == "" {
		return nil, fmt.Errorf("agent %s has no runtime model", agent.ID)
	}
	if strings.TrimSpace(target.Path) == "" {
		return nil, fmt.Errorf("agent %s has no runnable target", agent.ID)
	}

	task := strings.TrimSpace(agent.DefaultTask)
	if task == "" {
		task = triggerTask(trigger, domainEvent)
	}
	prompt, err := buildAgentPackPrompt(detail.Path, detail.Manifest, agent, trigger, target, domainEvent, task)
	if err != nil {
		return nil, err
	}

	run := &database.AgentRun{
		AgentID:     0,
		AgentName:   detail.Manifest.Name + " / " + agent.Name,
		AgentIcon:   agent.Icon,
		Task:        task,
		Model:       runtime.Model,
		ProjectPath: target.Path,
		Status:      "pending",
	}
	runID, err := s.app.dbManager.CreateAgentRun(run)
	if err != nil {
		return nil, err
	}
	run.ID = runID
	emitAgentPackRunChanged(s.app.eventHub, run, "pending", run.PID, nil, "", detail.Manifest.ID, agent.ID)

	sessionID := uuid.NewString()
	source := agentSessionSource{PackID: detail.Manifest.ID, AgentID: agent.ID}
	run.SessionID = sessionID
	s.markAutomationSession(sessionID, source)
	if err := s.app.dbManager.UpdateAgentRunSession(runID, sessionID); err != nil {
		log.Printf("[agent-packs] update run session failed: %v", err)
	}
	sessionConfig := s.app.providerSessionConfig(runtime.Provider, target.Path, runtime.Model, runtime.ProviderAPIID, "")
	sessionConfig.SessionID = sessionID
	sessionConfig.Prompt = prompt
	sessionConfig.ResumeSessionID = provider.FreshSessionSentinel
	sessionConfig.Extra = mergeStringMaps(sessionConfig.Extra, runtime.Config)

	startedSessionID, err := s.app.providerManager.EnsureUserSession(runtime.Provider, sessionConfig)
	if err != nil {
		completedAt := time.Now()
		if updateErr := s.app.dbManager.UpdateAgentRunStatus(runID, "failed", 0, nil, &completedAt); updateErr == nil {
			emitAgentPackRunChanged(s.app.eventHub, run, "failed", 0, &completedAt, err.Error(), detail.Manifest.ID, agent.ID)
		}
		return run, err
	}

	if startedSessionID != sessionID {
		run.SessionID = startedSessionID
		s.markAutomationSession(startedSessionID, source)
		if err := s.app.dbManager.UpdateAgentRunSession(runID, startedSessionID); err != nil {
			log.Printf("[agent-packs] update run session failed: %v", err)
		}
	}
	run.Status = "running"
	startedAt := time.Now()
	run.ProcessStartedAt = &startedAt
	if status := s.app.providerManager.GetSession(run.SessionID); status != nil {
		run.PID = status.PID
	}
	if err := s.app.dbManager.UpdateAgentRunStatus(runID, "running", run.PID, run.ProcessStartedAt, nil); err != nil {
		return run, err
	}
	emitAgentPackRunChanged(s.app.eventHub, run, "running", run.PID, nil, "", detail.Manifest.ID, agent.ID)
	return run, nil
}

func emitAgentPackRunChanged(hub *eventhub.EventHub, run *database.AgentRun, status string, pid int, completedAt *time.Time, errorMessage, packID, agentID string) {
	if hub == nil || run == nil {
		return
	}
	if status == "" {
		status = run.Status
	}
	if pid == 0 {
		pid = run.PID
	}
	if completedAt == nil {
		completedAt = run.CompletedAt
	}
	hub.EmitAgentRunChanged(eventhub.AgentRunChangedEvent{
		RunID:       run.ID,
		AgentID:     run.AgentID,
		AgentPackID: packID,
		PackAgentID: agentID,
		AgentName:   run.AgentName,
		AgentIcon:   run.AgentIcon,
		Task:        run.Task,
		Model:       run.Model,
		ProjectPath: run.ProjectPath,
		SessionID:   run.SessionID,
		Status:      status,
		PID:         pid,
		Error:       errorMessage,
		Timestamp:   time.Now().UTC(),
		CompletedAt: completedAt,
	})
}

func (s *agentPackScheduler) markAutomationSession(sessionID string, source agentSessionSource) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = source
}

func (s *agentPackScheduler) isAutomationSession(sessionID string) bool {
	_, ok := s.automationSessionSource(sessionID)
	return ok
}

func (s *agentPackScheduler) automationSessionSource(sessionID string) (agentSessionSource, bool) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return agentSessionSource{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sessions[sessionID]
	return source, ok
}

func buildAgentPackPrompt(packPath string, manifest agentpacks.PackManifest, agent agentpacks.AgentDefinition, trigger agentpacks.TriggerConfig, target agentPackTarget, domainEvent *eventhub.DomainEvent, task string) (string, error) {
	role, err := readPackTextFile(packPath, agent.Role)
	if err != nil {
		return "", fmt.Errorf("read agent role: %w", err)
	}
	var builder strings.Builder
	builder.WriteString(strings.TrimSpace(role))
	builder.WriteString("\n\n---\n\n")
	builder.WriteString("Agent Pack: ")
	builder.WriteString(manifest.Name)
	builder.WriteString(" (")
	builder.WriteString(manifest.ID)
	builder.WriteString("@")
	builder.WriteString(manifest.Version)
	builder.WriteString(")\n")
	builder.WriteString("Pack Path: ")
	builder.WriteString(packPath)
	builder.WriteString("\n")
	builder.WriteString("Target: ")
	builder.WriteString(target.Name)
	if target.ProjectName != "" {
		builder.WriteString(" in ")
		builder.WriteString(target.ProjectName)
	}
	builder.WriteString("\nTarget Path: ")
	builder.WriteString(target.Path)
	builder.WriteString("\nTrigger: ")
	builder.WriteString(triggerMode(trigger.Mode))
	if trigger.Schedule != "" {
		builder.WriteString(" (")
		builder.WriteString(trigger.Schedule)
		if trigger.Timezone != "" {
			builder.WriteString(", ")
			builder.WriteString(trigger.Timezone)
		}
		builder.WriteString(")")
	}
	if triggerEventType(trigger) != "" {
		builder.WriteString(" (")
		builder.WriteString(triggerEventType(trigger))
		if trigger.SessionType != "" {
			builder.WriteString(", ")
			builder.WriteString(trigger.SessionType)
			if trigger.SessionAgentID != "" {
				builder.WriteString(":")
				builder.WriteString(trigger.SessionAgentID)
			}
		}
		builder.WriteString(")")
	}
	builder.WriteString("\n\nTask:\n")
	builder.WriteString(strings.TrimSpace(task))
	builder.WriteString("\n")

	for _, capability := range agent.Capabilities {
		content, err := readPackTextFile(packPath, capability)
		if err != nil {
			return "", fmt.Errorf("read capability %q: %w", capability, err)
		}
		builder.WriteString("\n---\n\nSkill: ")
		builder.WriteString(capability)
		builder.WriteString("\n\n")
		builder.WriteString(strings.TrimSpace(content))
		builder.WriteString("\n")
	}

	if domainEvent != nil {
		data, _ := json.MarshalIndent(domainEvent, "", "  ")
		builder.WriteString("\n---\n\nEvent:\n")
		builder.Write(data)
		builder.WriteString("\n")
	}
	return builder.String(), nil
}

func readPackTextFile(packPath, rel string) (string, error) {
	root, err := filepath.Abs(packPath)
	if err != nil {
		return "", err
	}
	full, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "", err
	}
	within, err := filepath.Rel(root, full)
	if err != nil {
		return "", err
	}
	if within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes pack root")
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func triggerTask(trigger agentpacks.TriggerConfig, domainEvent *eventhub.DomainEvent) string {
	switch triggerMode(trigger.Mode) {
	case "schedule":
		return "Run the scheduled automation for this target."
	case "event":
		if domainEvent != nil && domainEvent.Type != "" {
			return "Handle the " + domainEvent.Type + " event for this target."
		}
		return "Handle the configured event for this target."
	default:
		return "Run this agent for the selected target."
	}
}

func (s *agentPackScheduler) allTargets() []agentPackTarget {
	if s.app == nil || s.app.dbManager == nil {
		return nil
	}
	projects, err := s.app.dbManager.GetAllProjectIndexes()
	if err != nil {
		log.Printf("[agent-packs] list projects for targets failed: %v", err)
		return nil
	}
	targets := make([]agentPackTarget, 0)
	seen := map[string]struct{}{}
	for _, project := range projects {
		projectName := strings.TrimSpace(project.Name)
		if projectPath := firstProviderPath(project.Providers); projectPath != "" {
			addAgentPackTarget(&targets, seen, agentPackTarget{
				Kind: "project",
				Path: projectPath,
				Name: defaultString(projectName, projectPath),
			})
		}
		for _, workspace := range project.Workspaces {
			workspacePath := firstProviderPath(workspace.Providers)
			if workspacePath == "" {
				continue
			}
			name := strings.TrimSpace(workspace.Name)
			if name == "" {
				name = strings.TrimSpace(workspace.Branch)
			}
			addAgentPackTarget(&targets, seen, agentPackTarget{
				Kind:        "workspace",
				Path:        workspacePath,
				Name:        defaultString(name, workspacePath),
				ProjectName: projectName,
			})
		}
	}
	sort.Slice(targets, func(i, j int) bool {
		return strings.ToLower(targets[i].Path) < strings.ToLower(targets[j].Path)
	})
	return targets
}

func addAgentPackTarget(targets *[]agentPackTarget, seen map[string]struct{}, target agentPackTarget) {
	key := normalizedPathKey(target.Path)
	if key == "" {
		return
	}
	if _, ok := seen[key]; ok {
		return
	}
	seen[key] = struct{}{}
	*targets = append(*targets, target)
}

func firstProviderPath(providers []database.ProviderInfo) string {
	for _, item := range providers {
		if strings.TrimSpace(item.Path) != "" {
			return item.Path
		}
	}
	return ""
}

func targetsForScope(scope map[string]any, all []agentPackTarget) []agentPackTarget {
	if strings.EqualFold(scopeString(scope, "type"), "selected") {
		targets := scopeTargets(scope)
		if len(targets) > 0 {
			return targets
		}
		return nil
	}
	return all
}

func scopeTargets(scope map[string]any) []agentPackTarget {
	raw, ok := scope["targets"]
	if !ok {
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	targets := make([]agentPackTarget, 0, len(items))
	for _, item := range items {
		values, ok := item.(map[string]any)
		if !ok {
			continue
		}
		path := strings.TrimSpace(scopeValue(values, "path"))
		if path == "" {
			continue
		}
		targets = append(targets, agentPackTarget{
			Kind:        defaultString(scopeValue(values, "type"), "project"),
			Path:        path,
			Name:        defaultString(scopeValue(values, "name"), path),
			ProjectName: scopeValue(values, "project_name"),
		})
	}
	return targets
}

func targetMatchesEvent(target agentPackTarget, event eventhub.DomainEvent) bool {
	if strings.TrimSpace(target.Path) == "" {
		return false
	}
	eventPaths := []string{
		event.Scope.WorkspacePath,
		event.Scope.ProjectPath,
		stringFromPayload(event.Payload, "workspace_path"),
		stringFromPayload(event.Payload, "project_path"),
		stringFromPayload(event.Payload, "path"),
		stringFromPayload(event.Payload, "cwd"),
	}
	targetKey := normalizedPathKey(target.Path)
	for _, path := range eventPaths {
		if normalizedPathKey(path) == targetKey {
			return true
		}
	}
	return false
}

func eventMatches(triggerEvent, eventType string) bool {
	triggerEvent = strings.TrimSpace(triggerEvent)
	if triggerEvent == "" || triggerEvent == "*" || strings.EqualFold(triggerEvent, "any") {
		return true
	}
	return strings.EqualFold(triggerEvent, eventType)
}

func triggerEventType(trigger agentpacks.TriggerConfig) string {
	if strings.TrimSpace(trigger.EventType) != "" {
		return strings.TrimSpace(trigger.EventType)
	}
	return strings.TrimSpace(trigger.Event)
}

func isSessionScopedEvent(eventType string) bool {
	eventType = strings.ToLower(strings.TrimSpace(eventType))
	return strings.HasPrefix(eventType, "session.") ||
		strings.HasPrefix(eventType, "process.")
}

func isAgentRunEvent(eventType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(eventType)), "agent.run.")
}

func triggerMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "scheduled":
		return "schedule"
	case "time":
		return "schedule"
	case "event-driven":
		return "event"
	default:
		return strings.ToLower(strings.TrimSpace(mode))
	}
}

func cronMatches(schedule string, now time.Time) bool {
	fields := strings.Fields(schedule)
	if len(fields) != 5 {
		return false
	}
	return cronFieldMatches(fields[0], now.Minute(), 0, 59) &&
		cronFieldMatches(fields[1], now.Hour(), 0, 23) &&
		cronFieldMatches(fields[2], now.Day(), 1, 31) &&
		cronFieldMatches(fields[3], int(now.Month()), 1, 12) &&
		cronFieldMatches(fields[4], int(now.Weekday()), 0, 7)
}

func cronFieldMatches(expr string, value, min, max int) bool {
	expr = strings.TrimSpace(expr)
	if expr == "*" {
		return true
	}
	for _, part := range strings.Split(expr, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			start, errA := strconv.Atoi(bounds[0])
			end, errB := strconv.Atoi(bounds[1])
			if errA != nil || errB != nil {
				continue
			}
			if max == 7 && end == 7 && value == 0 {
				return true
			}
			if value >= start && value <= end {
				return true
			}
			continue
		}
		needle, err := strconv.Atoi(part)
		if err != nil {
			continue
		}
		if max == 7 && needle == 7 {
			needle = 0
		}
		if needle >= min && needle <= max && value == needle {
			return true
		}
	}
	return false
}

func triggerTime(trigger agentpacks.TriggerConfig, fallback time.Time) time.Time {
	if trigger.Timezone == "" || strings.EqualFold(trigger.Timezone, "local") {
		return fallback
	}
	loc, err := time.LoadLocation(trigger.Timezone)
	if err != nil {
		return fallback
	}
	return fallback.In(loc)
}

func scheduleRunKey(packID, agentID string, triggerIndex int, targetPath string, now time.Time) string {
	return fmt.Sprintf("%s:%s:%d:%s:%d", packID, agentID, triggerIndex, normalizedPathKey(targetPath), now.Unix()/60)
}

func (s *agentPackScheduler) markRunSeen(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.lastRuns[key]; ok {
		return false
	}
	s.lastRuns[key] = struct{}{}
	if len(s.lastRuns) > 4096 {
		s.lastRuns = map[string]struct{}{key: {}}
	}
	return true
}

func scopeString(scope map[string]any, key string) string {
	if scope == nil {
		return ""
	}
	return scopeValue(scope, key)
}

func scopeValue(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func stringFromPayload(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	return scopeValue(payload, key)
}

func int64FromPayload(payload map[string]any, key string) int64 {
	if payload == nil {
		return 0
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		n, _ := typed.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return n
	default:
		n, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(typed)), 10, 64)
		return n
	}
}

func normalizedPathKey(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	cleaned := filepath.Clean(path)
	return strings.ToLower(cleaned)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func mergeStringMaps(base, overlay map[string]string) map[string]string {
	if len(base) == 0 && len(overlay) == 0 {
		return nil
	}
	merged := make(map[string]string, len(base)+len(overlay))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range overlay {
		merged[key] = value
	}
	return merged
}
