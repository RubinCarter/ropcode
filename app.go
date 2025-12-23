// app.go
package main

import (
	"context"
	"log"
	"sync"

	"ropcode/internal/claude"
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
	"ropcode/internal/session"
	"ropcode/internal/ssh"
)

// App struct contains the core application state and managers
type App struct {
	ctx    context.Context
	mu     sync.RWMutex
	config *config.Config

	// Core managers
	ptyManager     *pty.Manager
	processManager *process.Manager
	dbManager      *database.Database
	claudeManager  *claude.SessionManager
	geminiManager  *gemini.SessionManager
	codexManager   *codex.SessionManager
	mcpManager     *mcp.Manager
	sshManager     *ssh.Manager
	pluginManager  *plugin.Manager
	sessionManager *session.HistoryManager
	eventHub       *eventhub.EventHub
	gitWatcher     *git.GitWatcher
	modelRegistry  *models.Registry
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
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
	}

	// Initialize EventHub (before managers that need it)
	a.eventHub = eventhub.New(nil)

	// Create event emitter that uses EventHub
	eventEmitter := &eventEmitter{eventHub: a.eventHub}

	// Initialize PTY manager with event emitter
	a.ptyManager = pty.NewManager(ctx, eventEmitter)

	// Initialize process manager
	a.processManager = process.NewManager(ctx)
	a.processManager.SetEventHub(a.eventHub)

	// Initialize Claude session manager
	a.claudeManager = claude.NewSessionManager(ctx, eventEmitter)

	// Initialize Gemini session manager
	a.geminiManager = gemini.NewSessionManager(ctx, eventEmitter)

	// Initialize Codex session manager
	a.codexManager = codex.NewSessionManager(ctx, eventEmitter)

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

	log.Println("ropcode started successfully")
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
