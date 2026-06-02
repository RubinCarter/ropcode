package codex

import (
	"runtime"

	"ropcode/internal/provider"
)

type codexBuiltinSlashCommand struct {
	Name             string
	Description      string
	AcceptsArguments bool
	Visible          bool
}

func codexBuiltinSlashCommandSpecs() []codexBuiltinSlashCommand {
	return []codexBuiltinSlashCommand{
		// Codex app-server does not expose a slash-command list API. These
		// commands mirror codex-rs/tui/src/slash_command.rs.
		{Name: "model", Description: "choose what model and reasoning effort to use", Visible: true},
		{Name: "ide", Description: "include current selection, open files, and other context from your IDE", AcceptsArguments: true, Visible: true},
		{Name: "permissions", Description: "choose what Codex is allowed to do", Visible: true},
		{Name: "keymap", Description: "remap TUI shortcuts", AcceptsArguments: true, Visible: true},
		{Name: "vim", Description: "toggle Vim mode for the composer", Visible: true},
		{Name: "setup-default-sandbox", Description: "set up elevated agent sandbox", Visible: true},
		{Name: "sandbox-add-read-dir", Description: "let sandbox read a directory: /sandbox-add-read-dir <absolute_path>", AcceptsArguments: true, Visible: runtime.GOOS == "windows"},
		{Name: "experimental", Description: "toggle experimental features", Visible: true},
		{Name: "approve", Description: "approve one retry of a recent auto-review denial", Visible: true},
		{Name: "memories", Description: "configure memory use and generation", Visible: true},
		{Name: "skills", Description: "use skills to improve how Codex performs specific tasks", Visible: true},
		{Name: "hooks", Description: "view and manage lifecycle hooks", Visible: true},
		{Name: "review", Description: "review my current changes and find issues", AcceptsArguments: true, Visible: true},
		{Name: "rename", Description: "rename the current thread", AcceptsArguments: true, Visible: true},
		{Name: "new", Description: "start a new chat during a conversation", Visible: true},
		{Name: "archive", Description: "archive this session and exit", Visible: true},
		{Name: "resume", Description: "resume a saved chat", AcceptsArguments: true, Visible: true},
		{Name: "fork", Description: "fork the current chat", Visible: true},
		{Name: "init", Description: "create an AGENTS.md file with instructions for Codex", Visible: true},
		{Name: "compact", Description: "summarize conversation to prevent hitting the context limit", Visible: true},
		{Name: "plan", Description: "switch to Plan mode", AcceptsArguments: true, Visible: true},
		{Name: "goal", Description: "set or view the goal for a long-running task", AcceptsArguments: true, Visible: true},
		{Name: "agent", Description: "switch the active agent thread", Visible: true},
		{Name: "side", Description: "start a side conversation in an ephemeral fork", AcceptsArguments: true, Visible: true},
		{Name: "btw", Description: "start a side conversation in an ephemeral fork", AcceptsArguments: true, Visible: true},
		{Name: "copy", Description: "copy last response as markdown", Visible: runtime.GOOS != "android"},
		{Name: "raw", Description: "toggle raw scrollback mode for copy-friendly terminal selection", AcceptsArguments: true, Visible: true},
		{Name: "diff", Description: "show git diff (including untracked files)", Visible: true},
		{Name: "mention", Description: "mention a file", Visible: true},
		{Name: "status", Description: "show current session configuration and token usage", Visible: true},
		{Name: "debug-config", Description: "show config layers and requirement sources for debugging", Visible: true},
		{Name: "title", Description: "configure which items appear in the terminal title", Visible: true},
		{Name: "statusline", Description: "configure which items appear in the status line", Visible: true},
		{Name: "theme", Description: "choose a syntax highlighting theme", Visible: true},
		{Name: "pets", Description: "choose or hide the terminal pet", AcceptsArguments: true, Visible: true},
		{Name: "mcp", Description: "list configured MCP tools; use /mcp verbose for details", AcceptsArguments: true, Visible: true},
		{Name: "apps", Description: "manage apps", Visible: true},
		{Name: "plugins", Description: "browse plugins", Visible: true},
		{Name: "logout", Description: "log out of Codex", Visible: true},
		{Name: "quit", Description: "exit Codex", Visible: true},
		{Name: "exit", Description: "exit Codex", Visible: true},
		{Name: "feedback", Description: "send logs to maintainers", Visible: true},
		{Name: "ps", Description: "list background terminals", Visible: true},
		{Name: "stop", Description: "stop all background terminals", Visible: true},
		{Name: "clear", Description: "clear the terminal and start a new chat", Visible: true},
		{Name: "personality", Description: "choose a communication style for Codex", Visible: true},
		{Name: "realtime", Description: "toggle realtime voice mode (experimental)", Visible: true},
		{Name: "settings", Description: "configure realtime microphone/speaker", Visible: true},
		{Name: "subagents", Description: "switch the active agent thread", Visible: true},
		{Name: "debug-m-drop", Description: "DO NOT USE", Visible: true},
		{Name: "debug-m-update", Description: "DO NOT USE", Visible: true},
	}
}

func codexBuiltinSlashCommands(providerID string) []provider.Capability {
	commands := codexBuiltinSlashCommandSpecs()
	capabilities := make([]provider.Capability, 0, len(commands))
	for _, command := range commands {
		if !command.Visible {
			continue
		}
		capability := provider.Capability{
			Provider:         providerID,
			Name:             command.Name,
			SlashName:        "/" + command.Name,
			Kind:             string(provider.CapabilityKindCommand),
			Description:      command.Description,
			Scope:            string(provider.CapabilityScopeSystem),
			AcceptsArguments: command.AcceptsArguments,
		}
		capability.Key = provider.CapabilityKey(capability.Provider, capability.Kind, capability.SlashName)
		capabilities = append(capabilities, capability)
	}
	return capabilities
}
