// app.go
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"ropcode/internal/claude"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/git"
	"ropcode/internal/mcp"
	"ropcode/internal/models"
	"ropcode/internal/plugin"
	"ropcode/internal/process"
	"ropcode/internal/projectchat"
	"ropcode/internal/provider"
	providerClaude "ropcode/internal/provider/claude"
	providerCodex "ropcode/internal/provider/codex"
	providerDeepseek "ropcode/internal/provider/deepseek"
	providerGemini "ropcode/internal/provider/gemini"
	providerPi "ropcode/internal/provider/pi"
	"ropcode/internal/pty"
	appRuntime "ropcode/internal/runtime"
	"ropcode/internal/ssh"
	"ropcode/internal/stream"
	"ropcode/rpc"
)

// App struct contains the core application state and managers
type App struct {
	ctx    context.Context
	mu     sync.RWMutex
	config *config.Config

	// Core managers
	ptyManager          *pty.Manager
	processManager      *process.Manager
	dbManager           *database.Database
	providerManager     *provider.Manager
	claudeActivity      *claudeactivity.Service
	mcpManager          *mcp.Manager
	sshManager          *ssh.Manager
	pluginManager       *plugin.Manager
	eventHub            *eventhub.EventHub
	sessionStreamHub    *stream.Hub
	syncHub             *stream.SyncHub
	bulkHub             *stream.BulkHub
	gitWatcher          *git.GitWatcher
	modelRegistry       *models.Registry
	capabilityDiscovery claude.CapabilityDiscovery
	sessionTitles       *sessionTitleStore
	projectChatManager  *projectchat.Manager
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		sessionTitles: newSessionTitleStore(),
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Load config
	cfg, err := config.Load()
	if err != nil {
		log.Printf("Failed to load config: %v", err)
		return
	}
	a.config = cfg

	// Initialize database
	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		log.Printf("Failed to open database: %v", err)
	} else {
		a.dbManager = db

		// Initialize model registry and sync builtin models
		a.modelRegistry = models.NewRegistry(db)
		if err := a.modelRegistry.Initialize(); err != nil {
			log.Printf("Failed to initialize model registry: %v", err)
		}
		a.SyncPiModelsFromLocalConfig()

		a.loadGeneratedSessionTitles()
	}

	// Initialize EventHub (before managers that need it)
	a.eventHub = eventhub.New(nil)
	a.sessionStreamHub = stream.NewHub()
	a.syncHub = stream.NewSyncHub()
	a.bulkHub = stream.NewBulkHub()

	// Create event emitter that uses EventHub
	eventEmitter := &eventEmitter{eventHub: a.eventHub}
	a.claudeActivity = claudeactivity.NewService()
	providerEmitter := &providerStreamEmitter{
		eventHub:       a.eventHub,
		bridge:         stream.NewProviderBridge(a.sessionStreamHub),
		claudeActivity: a.claudeActivity,
		db:             a.dbManager,
	}

	// Initialize PTY manager with event emitter
	a.ptyManager = pty.NewManager(ctx, eventEmitter)
	a.ptyManager.SetBulkHub(a.bulkHub)

	// Initialize process manager
	a.processManager = process.NewManager(ctx)
	a.processManager.SetEventHub(a.eventHub)

	// Initialize unified provider manager
	a.providerManager = provider.NewManager(ctx, providerEmitter, nil)
	a.providerManager.RegisterDriver(&providerClaude.Driver{Activity: a.claudeActivity})
	a.providerManager.RegisterDriver(&providerCodex.Driver{})
	a.providerManager.RegisterDriver(&providerGemini.Driver{})
	a.providerManager.RegisterDriver(&providerDeepseek.Driver{})
	a.providerManager.RegisterDriver(&providerPi.Driver{})

	// Initialize project chat manager
	a.projectChatManager = projectchat.NewManager(a.dbManager, a.providerManager, a.eventHub, a.sessionStreamHub)
	a.projectChatManager.SetSessionConfigResolver(a.providerSessionConfig)

	// Initialize MCP manager
	// Note: MCP manager now uses dynamic claude binary detection on each command execution
	// This ensures it works in .app packages where PATH is limited
	a.mcpManager = mcp.NewManager(cfg.ClaudeDir)

	// Initialize SSH manager
	a.sshManager = ssh.NewManager()

	// Initialize plugin manager
	a.pluginManager = plugin.NewManager(cfg.ClaudeDir)

	// Initialize GitWatcher (EventHub already initialized above)
	a.gitWatcher = git.NewGitWatcher(a.eventHub)

	go func() {
		service, err := a.getClaudeCapabilityDiscovery()
		if err != nil {
			return
		}
		_ = service.PrewarmSystem()
	}()

	go func() {
		service, err := a.getClaudeCapabilityDiscovery()
		if err != nil {
			return
		}
		_ = service.PrewarmUser()
	}()

	log.Println("ropcode started successfully")
}

func (a *App) getClaudeCapabilityDiscovery() (claude.CapabilityDiscovery, error) {
	a.mu.RLock()
	if a.capabilityDiscovery != nil {
		service := a.capabilityDiscovery
		a.mu.RUnlock()
		return service, nil
	}
	a.mu.RUnlock()

	transport, err := claude.NewClaudeCapabilityDiscoveryTransport()
	if err != nil {
		return nil, err
	}
	service := claude.NewCapabilityDiscoveryService(transport)
	a.mu.Lock()
	a.capabilityDiscovery = service
	a.mu.Unlock()
	return service, nil
}

// shutdown is called when the app is shutting down
func (a *App) shutdown(ctx context.Context) {
	// Close GitWatcher
	if a.gitWatcher != nil {
		a.gitWatcher.Close()
	}

	// Close PTY sessions
	if a.ptyManager != nil {
		a.ptyManager.CloseAll()
	}

	// Kill all processes
	if a.processManager != nil {
		a.processManager.KillAll()
	}

	// Shutdown unified provider manager
	if a.providerManager != nil {
		a.providerManager.Shutdown()
	}

	// Close database
	if a.dbManager != nil {
		a.dbManager.Close()
	}

	log.Println("ropcode shutdown complete")
}

// eventEmitter adapts EventHub to pty.EventEmitter
type eventEmitter struct {
	eventHub *eventhub.EventHub
}

func (e *eventEmitter) Emit(eventName string, data interface{}) {
	e.eventHub.Emit(eventName, data)
}

// providerStreamEmitter routes unified provider output into the session stream
// hub while preserving low-frequency process/session events on EventHub.
type providerStreamEmitter struct {
	eventHub       *eventhub.EventHub
	bridge         *stream.ProviderBridge
	claudeActivity *claudeactivity.Service
	db             *database.Database
}

func (e *providerStreamEmitter) Emit(eventName string, data interface{}) {
	if eventName != "provider-output" {
		if eventName == "process:changed" {
			e.updateAgentRunFromProcessEvent(data)
		}
		e.eventHub.Emit(eventName, data)
		return
	}

	event, ok := providerOutputEventFrom(data)
	if !ok || e.bridge == nil {
		return
	}
	if event.Provider == "claude" && e.claudeActivity != nil {
		e.claudeActivity.EnsureSession(
			event.SessionID,
			event.ProjectPath,
			true,
			nil,
		)
		e.claudeActivity.ObserveClaudeEvent(event.SessionID, event.Message)
	}
	_ = e.bridge.EmitProviderOutput(stream.ProviderOutputContext{
		RuntimeSessionID:  event.SessionID,
		ProviderSessionID: event.ProviderSessionID,
		Provider:          event.Provider,
		Cwd:               event.Cwd,
		ProjectPath:       event.ProjectPath,
	}, event)
}

func providerOutputEventFrom(data interface{}) (provider.OutputEvent, bool) {
	switch event := data.(type) {
	case provider.OutputEvent:
		return event, true
	case *provider.OutputEvent:
		if event == nil {
			return provider.OutputEvent{}, false
		}
		return *event, true
	default:
		return provider.OutputEvent{}, false
	}
}

func providerProcessChangedEventFrom(data interface{}) (provider.ProcessChangedEvent, bool) {
	switch event := data.(type) {
	case provider.ProcessChangedEvent:
		return event, true
	case *provider.ProcessChangedEvent:
		if event == nil {
			return provider.ProcessChangedEvent{}, false
		}
		return *event, true
	default:
		return provider.ProcessChangedEvent{}, false
	}
}

func (e *providerStreamEmitter) updateAgentRunFromProcessEvent(data interface{}) {
	if e.db == nil {
		return
	}
	event, ok := providerProcessChangedEventFrom(data)
	if !ok || event.State != "stopped" || event.SessionID == "" {
		return
	}

	run, err := e.db.GetAgentRunBySessionID(event.SessionID)
	if err != nil || run == nil {
		return
	}
	if run.Status != "running" && run.Status != "pending" {
		return
	}

	status := "completed"
	if event.ExitCode != nil && *event.ExitCode != 0 {
		status = "failed"
	}
	pid := event.PID
	if pid == 0 {
		pid = run.PID
	}
	completedAt := time.Now()
	_ = e.db.UpdateAgentRunStatus(run.ID, status, pid, run.ProcessStartedAt, &completedAt)
}

func replayClaudeActivityOutput(activity *claudeactivity.Service, sessionID, output string) {
	if activity == nil || sessionID == "" || output == "" {
		return
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		var msg map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue
		}
		activity.ObserveClaudeEvent(sessionID, msg)
	}
}

// SetBroadcaster sets the WebSocket broadcaster
func (a *App) SetBroadcaster(b eventhub.Broadcaster) {
	a.eventHub.SetBroadcaster(b)
}

// Startup public method for server mode
func (a *App) Startup(ctx context.Context) {
	a.startup(ctx)
}

// Shutdown public method for server mode
func (a *App) Shutdown(ctx context.Context) {
	a.shutdown(ctx)
}

// BootstrapRuntime starts a new App using the shared runtime bootstrap helper.
func BootstrapRuntime(ctx context.Context) (*App, func(context.Context), error) {
	return appRuntime.Start(ctx, NewApp)
}

// EventHub exposes the initialized event hub for read-only runtime composition.
func (a *App) EventHub() *eventhub.EventHub {
	return a.eventHub
}

// SessionStreamHub exposes the frontend-facing session stream hub.
func (a *App) SessionStreamHub() *stream.Hub {
	return a.sessionStreamHub
}

// SyncHub exposes the frontend-facing low-frequency sync hub.
func (a *App) SyncHub() *stream.SyncHub {
	return a.syncHub
}

// BulkHub exposes the frontend-facing bulk output hub.
func (a *App) BulkHub() *stream.BulkHub {
	return a.bulkHub
}

// Database exposes the initialized database manager for read-only runtime composition.
func (a *App) Database() *database.Database {
	return a.dbManager
}

// RPCDeps returns the dependency bag for the new RPC handler layer.
func (a *App) RPCDeps() *rpc.Deps {
	var capDisc claude.CapabilityDiscovery
	if a.capabilityDiscovery != nil {
		capDisc = a.capabilityDiscovery
	}
	return &rpc.Deps{
		Provider:     a.providerManager,
		ProjectChat:  a.projectChatManager,
		DB:           a.dbManager,
		MCP:          a.mcpManager,
		SSH:          a.sshManager,
		Plugin:       a.pluginManager,
		Pty:          a.ptyManager,
		Process:      a.processManager,
		Models:       a.modelRegistry,
		Config:       a.config,
		EventHub:     a.eventHub,
		Activity:     a.claudeActivity,
		CapDiscovery: capDisc,
		BulkHub:      a.bulkHub,
	}
}

// ClaudeManager exposes the initialized Claude session manager for read-only runtime composition.
// Greet returns a greeting for the given name (keep for testing)
func (a *App) Greet(name string) string {
	return "Hello " + name + ", Welcome to ropcode!"
}

// WatchGitWorkspace 开始监听指定工作区的 Git 变化
func (a *App) WatchGitWorkspace(workspacePath string) error {
	if a.gitWatcher == nil {
		return nil
	}
	return a.gitWatcher.Watch(workspacePath)
}

// UnwatchGitWorkspace 停止监听指定工作区的 Git 变化
func (a *App) UnwatchGitWorkspace(workspacePath string) {
	if a.gitWatcher == nil {
		return
	}
	a.gitWatcher.Unwatch(workspacePath)
}
