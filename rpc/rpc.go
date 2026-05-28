package rpc

import "encoding/json"

// Handler is the single function signature for all RPC methods.
// params is the raw JSON array of arguments from the WebSocket message.
type Handler = func(params json.RawMessage) (any, error)

// Build assembles the complete RPC method table from all domain handlers.
func Build(deps *Deps) map[string]Handler {
	m := make(map[string]Handler, 256)
	merge(m, PtyHandlers(deps))
	merge(m, SSHHandlers(deps))
	merge(m, StorageHandlers(deps))
	merge(m, PluginHandlers(deps))
	merge(m, ActionsHandlers(deps))
	merge(m, SkillsHandlers(deps))
	merge(m, FilesystemHandlers(deps))
	merge(m, UsageHandlers(deps))
	merge(m, MCPHandlers(deps))
	merge(m, GitHandlers(deps))
	merge(m, SettingsHandlers(deps))
	merge(m, HookHandlers(deps))
	merge(m, ModelHandlers(deps))
	merge(m, AgentHandlers(deps))
	merge(m, ProjectHandlers(deps))
	merge(m, SessionHandlers(deps))
	merge(m, ProjectChatHandlers(deps))
	merge(m, MiscHandlers(deps))
	merge(m, ClaudeAgentsHandlers(deps))
	return m
}

func merge(dst, src map[string]Handler) {
	for k, v := range src {
		dst[k] = v
	}
}
