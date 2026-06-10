package rpc

import (
	"ropcode/internal/agentpacks"
	"ropcode/internal/claudeactivity"
	"ropcode/internal/config"
	"ropcode/internal/database"
	"ropcode/internal/eventhub"
	"ropcode/internal/mcp"
	"ropcode/internal/models"
	"ropcode/internal/plugin"
	"ropcode/internal/process"
	"ropcode/internal/projectchat"
	"ropcode/internal/provider"
	"ropcode/internal/pty"
	"ropcode/internal/ssh"
	"ropcode/internal/stream"
)

// Deps holds all dependencies needed by RPC handlers.
type Deps struct {
	Provider    *provider.Manager
	ProjectChat *projectchat.Manager
	DB          *database.Database
	MCP         *mcp.Manager
	SSH         *ssh.Manager
	Plugin      *plugin.Manager
	Pty         *pty.Manager
	Process     *process.Manager
	Models      *models.Registry
	Config      *config.Config
	EventHub    *eventhub.EventHub
	Activity    *claudeactivity.Service
	BulkHub     *stream.BulkHub
	AgentPacks  *agentpacks.Manager
}
