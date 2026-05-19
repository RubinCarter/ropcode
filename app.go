// app.go
package main

import (
	"context"
	"log"
	"sync"

	"ropcode/internal/claude"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/codex"
	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/gemini"
	"ropcode/internal/git"
	"ropcode/internal/mcp"
	"ropcode/internal/models"
	"ropcode/internal/plugin"
	"ropcode/internal/process"
	"ropcode/internal/pty"
	appRuntime "ropcode/internal/runtime"
	"ropcode/internal/session"
	"ropcode/internal/ssh"
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
	claudeManager       *claude.SessionManager
	claudeActivity      *claudeactivity.Service
	geminiManager       *gemini.SessionManager
	codexManager        *codex.SessionManager
	mcpManager          *mcp.Manager
	sshManager          *ssh.Manager
	pluginManager       *plugin.Manager
	sessionManager      *session.HistoryManager
	eventHub            *eventhub.EventHub
	aiOutputCoalescer   *eventhub.ClaudeOutputCoalescer
	gitWatcher          *git.GitWatcher
	modelRegistry       *models.Registry
	capabilityDiscovery claudeCapabilityDiscovery
	sessionTitles       *sessionTitleStore
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

		a.loadGeneratedSessionTitles()
	}

	// Initialize EventHub (before managers that need it)
	a.eventHub = eventhub.New(nil)

	// Create event emitter that uses EventHub
	eventEmitter := &eventEmitter{eventHub: a.eventHub}

	// Coalesce high-frequency claude-output events (Claude/Codex/Gemini stream
	// frames) into 16ms claude-output-batch frames so the WebSocket Send queue
	// isn't saturated during long streaming runs. Other event types pass
	// through unchanged after flushing any pending batch.
	a.aiOutputCoalescer = eventhub.NewClaudeOutputCoalescer(a.eventHub.Emit)
	aiSessionEmitter := &coalescedEmitter{coalescer: a.aiOutputCoalescer}

	// Initialize PTY manager with event emitter
	a.ptyManager = pty.NewManager(ctx, eventEmitter)

	// Initialize process manager
	a.processManager = process.NewManager(ctx)
	a.processManager.SetEventHub(a.eventHub)

	// Initialize Claude session manager
	a.claudeActivity = claudeactivity.NewService()
	a.claudeManager = claude.NewSessionManager(ctx, aiSessionEmitter)
	a.claudeManager.SetProcessEmitter(&claudeProcessEmitter{eventHub: a.eventHub})
	a.claudeManager.SetActivityObserver(a.claudeActivity)

	// Initialize Gemini session manager
	a.geminiManager = gemini.NewSessionManager(ctx, aiSessionEmitter)
	a.geminiManager.SetProcessEmitter(&geminiProcessEmitter{eventHub: a.eventHub})

	// Initialize Codex session manager
	a.codexManager = codex.NewSessionManager(ctx, aiSessionEmitter)
	a.codexManager.SetProcessEmitter(&codexProcessEmitter{eventHub: a.eventHub})

	// Initialize MCP manager
	// Note: MCP manager now uses dynamic claude binary detection on each command execution
	// This ensures it works in .app packages where PATH is limited
	a.mcpManager = mcp.NewManager(cfg.ClaudeDir)

	// Initialize SSH manager
	a.sshManager = ssh.NewManager()

	// Initialize plugin manager
	a.pluginManager = plugin.NewManager(cfg.ClaudeDir)

	// Initialize session history manager
	a.sessionManager = session.NewHistoryManager(cfg.ClaudeDir)

	// Initialize GitWatcher (EventHub already initialized above)
	a.gitWatcher = git.NewGitWatcher(a.eventHub)

	go func() {
		service, err := a.getClaudeCapabilityDiscovery()
		if err != nil {
			log.Printf("[capability-discovery] startup prewarm init failed: %v", err)
			return
		}
		ok := service.PrewarmSystem()
		log.Printf("[capability-discovery] startup system prewarm ok=%t", ok)
	}()

	go func() {
		service, err := a.getClaudeCapabilityDiscovery()
		if err != nil {
			log.Printf("[capability-discovery] startup user prewarm init failed: %v", err)
			return
		}
		ok := service.PrewarmUser()
		log.Printf("[capability-discovery] startup user prewarm ok=%t", ok)
	}()

	log.Println("ropcode started successfully")
	log.Printf("[claudeactivity] build=%s", claudeactivity.ActivityServiceBuild)
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

	// Cleanup Claude sessions
	if a.claudeManager != nil {
		a.claudeManager.CleanupCompleted()
	}

	// Cleanup Gemini sessions
	if a.geminiManager != nil {
		a.geminiManager.CleanupCompleted()
	}

	// Cleanup Codex sessions
	if a.codexManager != nil {
		a.codexManager.CleanupCompleted()
	}

	// Flush any pending claude-output batches so the front-end sees the final
	// stream lines before the connection drops.
	if a.aiOutputCoalescer != nil {
		a.aiOutputCoalescer.Close()
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

// coalescedEmitter adapts ClaudeOutputCoalescer to the EventEmitter interface
// expected by Claude/Codex/Gemini session managers. The coalescer batches
// "claude-output" frames in 16ms windows; other event names pass through
// after flushing pending batches so order is preserved.
type coalescedEmitter struct {
	coalescer *eventhub.ClaudeOutputCoalescer
}

func (e *coalescedEmitter) Emit(eventName string, data interface{}) {
	if e.coalescer == nil {
		return
	}
	e.coalescer.Emit(eventName, data)
}

// claudeProcessEmitter adapts EventHub to claude.ProcessChangedEmitter
type claudeProcessEmitter struct {
	eventHub *eventhub.EventHub
}

func (e *claudeProcessEmitter) EmitProcessChanged(event claude.ProcessChangedEvent) {
	e.eventHub.EmitProcessChanged(eventhub.ProcessChangedEvent{
		PID:      event.PID,
		Cwd:      event.Cwd,
		State:    event.State,
		ExitCode: event.ExitCode,
	})
}

// geminiProcessEmitter adapts EventHub to gemini.ProcessChangedEmitter
type geminiProcessEmitter struct {
	eventHub *eventhub.EventHub
}

func (e *geminiProcessEmitter) EmitProcessChanged(event gemini.ProcessChangedEvent) {
	e.eventHub.EmitProcessChanged(eventhub.ProcessChangedEvent{
		PID:      event.PID,
		Cwd:      event.Cwd,
		State:    event.State,
		ExitCode: event.ExitCode,
	})
}

// codexProcessEmitter adapts EventHub to codex.ProcessChangedEmitter
type codexProcessEmitter struct {
	eventHub *eventhub.EventHub
}

func (e *codexProcessEmitter) EmitProcessChanged(event codex.ProcessChangedEvent) {
	e.eventHub.EmitProcessChanged(eventhub.ProcessChangedEvent{
		PID:      event.PID,
		Cwd:      event.Cwd,
		State:    event.State,
		ExitCode: event.ExitCode,
	})
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

// Database exposes the initialized database manager for read-only runtime composition.
func (a *App) Database() *database.Database {
	return a.dbManager
}

// ClaudeManager exposes the initialized Claude session manager for read-only runtime composition.
func (a *App) ClaudeManager() *claude.SessionManager {
	return a.claudeManager
}

// GeminiManager exposes the initialized Gemini session manager for read-only runtime composition.
func (a *App) GeminiManager() *gemini.SessionManager {
	return a.geminiManager
}

// CodexManager exposes the initialized Codex session manager for read-only runtime composition.
func (a *App) CodexManager() *codex.SessionManager {
	return a.codexManager
}

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
