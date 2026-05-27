package rpc

import (
	"ropcode/internal/claude"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/mcp"
	"ropcode/internal/models"
	"ropcode/internal/plugin"
	"ropcode/internal/process"
	"ropcode/internal/provider"
	"ropcode/internal/pty"
	"ropcode/internal/ssh"
	"ropcode/internal/stream"
)

// Deps holds all dependencies needed by RPC handlers.
type Deps struct {
	Provider       *provider.Manager
	DB             *database.Database
	MCP            *mcp.Manager
	SSH            *ssh.Manager
	Plugin         *plugin.Manager
	Pty            *pty.Manager
	Process        *process.Manager
	Models         *models.Registry
	Config         *config.Config
	EventHub       *eventhub.EventHub
	Activity       *claudeactivity.Service
	CapDiscovery   claude.CapabilityDiscovery
	BulkHub        *stream.BulkHub
}
