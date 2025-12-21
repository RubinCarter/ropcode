// app.go
package main

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ropcode/internal/claude"
	"ropcode/internal/codex"
	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/gemini"
	"ropcode/internal/git"
	"ropcode/internal/mcp"
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
		runtime.LogError(ctx, "Failed to load config: "+err.Error())
		return
	}
	a.config = cfg

	// Initialize database
	db, err := database.Open(cfg.DatabasePath)
	if err != nil {
		runtime.LogError(ctx, "Failed to open database: "+err.Error())
	} else {
		a.dbManager = db
	}

	// Initialize EventHub (before managers that need it)
	a.eventHub = eventhub.New(ctx)

	// Initialize PTY manager with event emitter
	a.ptyManager = pty.NewManager(ctx, &wailsEventEmitter{ctx: ctx})

	// Initialize process manager
	a.processManager = process.NewManager(ctx)
	a.processManager.SetEventHub(a.eventHub)

	// Initialize Claude session manager
	a.claudeManager = claude.NewSessionManager(ctx, &wailsEventEmitter{ctx: ctx})

	// Initialize Gemini session manager
	a.geminiManager = gemini.NewSessionManager(ctx, &wailsEventEmitter{ctx: ctx})

	// Initialize Codex session manager
	a.codexManager = codex.NewSessionManager(ctx, &wailsEventEmitter{ctx: ctx})

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

	runtime.LogDebug(ctx, "DEBUG: All managers initialized")
	runtime.LogInfo(ctx, "ropcode started successfully")
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

	runtime.LogInfo(ctx, "ropcode shutdown complete")
}

// wailsEventEmitter adapts Wails runtime events to pty.EventEmitter
type wailsEventEmitter struct {
	ctx context.Context
}

func (e *wailsEventEmitter) Emit(eventName string, data interface{}) {
	runtime.EventsEmit(e.ctx, eventName, data)
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
