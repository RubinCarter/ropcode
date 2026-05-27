package rpc

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ropcode/internal/actions"
	"ropcode/internal/claude"
	"ropcode/internal/command"
	"ropcode/internal/database"
	"ropcode/internal/filesystem"
	"ropcode/internal/github"
	"ropcode/internal/mcp"
	"ropcode/internal/openin"
	"ropcode/internal/skills"
	"ropcode/internal/ssh"
	"ropcode/internal/usage"

	"github.com/google/uuid"
)

func PtyHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"CreatePtySession": func(p json.RawMessage) (any, error) {
			var args []json.RawMessage
			json.Unmarshal(p, &args)
			id := argString(p, 0)
			cwd := argString(p, 1)
			rows := argInt(p, 2)
			cols := argInt(p, 3)
			shell := argString(p, 4)
			session, err := d.Pty.CreateSession(id, cwd, rows, cols, shell)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"session_id": session.ID,
				"cwd":        session.Cwd,
				"shell":      session.Shell,
				"rows":       session.Rows,
				"cols":       session.Cols,
			}, nil
		},
		"WriteToPty": func(p json.RawMessage) (any, error) {
			return nil, d.Pty.Write(argString(p, 0), argString(p, 1))
		},
		"ResizePty": func(p json.RawMessage) (any, error) {
			return nil, d.Pty.Resize(argString(p, 0), argInt(p, 1), argInt(p, 2))
		},
		"ClosePtySession": func(p json.RawMessage) (any, error) {
			return nil, d.Pty.CloseSession(argString(p, 0))
		},
		"ListPtySessions": func(p json.RawMessage) (any, error) {
			return d.Pty.ListSessions(), nil
		},
		"IsPtySessionAlive": func(p json.RawMessage) (any, error) {
			id := argString(p, 0)
			sessions := d.Pty.ListSessions()
			for _, s := range sessions {
				if s == id {
					return true, nil
				}
			}
			return false, nil
		},
		"SpawnProcess": func(p json.RawMessage) (any, error) {
			key := argString(p, 0)
			command := argString(p, 1)
			args := argObject[[]string](p, 2)
			cwd := argString(p, 3)
			env := argObject[[]string](p, 4)
			proc, err := d.Process.Spawn(key, command, args, cwd, env)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"key":     proc.Key,
				"pid":     proc.PID,
				"running": proc.IsRunning(),
			}, nil
		},
		"KillProcess": func(p json.RawMessage) (any, error) {
			return nil, d.Process.Kill(argString(p, 0))
		},
		"IsProcessAlive": func(p json.RawMessage) (any, error) {
			return d.Process.IsAlive(argString(p, 0)), nil
		},
		"ListProcesses": func(p json.RawMessage) (any, error) {
			return d.Process.List(), nil
		},
		"KillCommand": func(p json.RawMessage) (any, error) {
			return nil, d.Process.Kill(argString(p, 0))
		},
		"CleanupFinishedProcesses": func(p json.RawMessage) (any, error) {
			all := d.Process.List()
			var cleaned []string
			for _, key := range all {
				if !d.Process.IsAlive(key) {
					cleaned = append(cleaned, key)
				}
			}
			return cleaned, nil
		},
	}
}

func SSHHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"ListGlobalSshConnections": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return []any{}, nil
			}
			return d.SSH.ListGlobalConnections()
		},
		"AddGlobalSshConnection": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			conn := argObject[ssh.SshConnection](p, 0)
			return nil, d.SSH.AddGlobalConnection(conn)
		},
		"DeleteGlobalSshConnection": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.DeleteGlobalConnection(argString(p, 0))
		},
		"SyncFromSSH": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.SyncFromSSH(argString(p, 0), argString(p, 1), argString(p, 2))
		},
		"SyncToSSH": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.SyncToSSH(argString(p, 0), argString(p, 1), argString(p, 2))
		},
		"StartAutoSync": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.StartAutoSync(argString(p, 0), argString(p, 1), argString(p, 2))
		},
		"StopAutoSync": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.StopAutoSync(argString(p, 0))
		},
		"PauseSshSync": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.PauseSshSync(argString(p, 0))
		},
		"ResumeSshSync": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.ResumeSshSync(argString(p, 0))
		},
		"CancelSshSync": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return nil, d.SSH.CancelSshSync(argString(p, 0))
		},
		"GetAutoSyncStatus": func(p json.RawMessage) (any, error) {
			if d.SSH == nil {
				return nil, fmt.Errorf("SSH manager not initialized")
			}
			return d.SSH.GetAutoSyncStatus(argString(p, 0))
		},
	}
}

func StorageHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"StorageListTables": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return d.DB.ListTables()
		},
		"StorageReadTable": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return d.DB.ReadTable(argString(p, 0), argInt(p, 1), argInt(p, 2))
		},
		"StorageInsertRow": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			table := argString(p, 0)
			data := argObject[map[string]interface{}](p, 1)
			return d.DB.InsertRow(table, data)
		},
		"StorageUpdateRow": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			table := argString(p, 0)
			id := int64(argInt(p, 1))
			data := argObject[map[string]interface{}](p, 2)
			return nil, d.DB.UpdateRow(table, id, data)
		},
		"StorageDeleteRow": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, d.DB.DeleteRow(argString(p, 0), int64(argInt(p, 1)))
		},
		"StorageExecuteSql": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return d.DB.ExecuteSQL(argString(p, 0))
		},
		"StorageResetDatabase": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			return nil, d.DB.ResetDatabase()
		},
	}
}

func PluginHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"ListInstalledPlugins": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return []any{}, nil
			}
			return d.Plugin.ListInstalled()
		},
		"GetPluginDetails": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return nil, fmt.Errorf("plugin manager not initialized")
			}
			return d.Plugin.GetDetails(argString(p, 0))
		},
		"GetPluginContents": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return nil, fmt.Errorf("plugin manager not initialized")
			}
			return d.Plugin.GetContents(argString(p, 0))
		},
		"ListPluginAgents": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return []any{}, nil
			}
			return d.Plugin.ListAgents(argString(p, 0))
		},
		"ListPluginCommands": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return []any{}, nil
			}
			return d.Plugin.ListCommands(argString(p, 0))
		},
		"ListPluginSkills": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return []any{}, nil
			}
			return d.Plugin.ListSkills(argString(p, 0))
		},
		"ListPluginHooks": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return []any{}, nil
			}
			return d.Plugin.ListHooks(argString(p, 0))
		},
		"GetPluginAgent": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return nil, fmt.Errorf("plugin manager not initialized")
			}
			return d.Plugin.GetAgent(argString(p, 0), argString(p, 1))
		},
		"GetPluginCommand": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return nil, fmt.Errorf("plugin manager not initialized")
			}
			return d.Plugin.GetCommand(argString(p, 0), argString(p, 1))
		},
		"GetPluginSkill": func(p json.RawMessage) (any, error) {
			if d.Plugin == nil {
				return nil, fmt.Errorf("plugin manager not initialized")
			}
			return d.Plugin.GetSkill(argString(p, 0), argString(p, 1))
		},
	}
}

func ActionsHandlers(_ *Deps) map[string]Handler {
	return map[string]Handler{
		"GetActions": func(p json.RawMessage) (any, error) {
			return actions.GetAll(argString(p, 0), argString(p, 1))
		},
		"GetGlobalActions": func(p json.RawMessage) (any, error) {
			return actions.GetGlobal()
		},
		"UpdateGlobalActions": func(p json.RawMessage) (any, error) {
			acts := argObject[[]actions.Action](p, 0)
			return nil, actions.UpdateGlobal(acts)
		},
		"UpdateProjectActions": func(p json.RawMessage) (any, error) {
			return nil, actions.UpdateProject(argString(p, 0), argObject[[]actions.Action](p, 1))
		},
		"UpdateWorkspaceActions": func(p json.RawMessage) (any, error) {
			return nil, actions.UpdateWorkspace(argString(p, 0), argObject[[]actions.Action](p, 1))
		},
	}
}

func SkillsHandlers(_ *Deps) map[string]Handler {
	return map[string]Handler{
		"SkillsList": func(p json.RawMessage) (any, error) {
			return skills.List(argString(p, 0))
		},
		"SkillGet": func(p json.RawMessage) (any, error) {
			return skills.Get(argString(p, 0), argString(p, 1))
		},
	}
}

func FilesystemHandlers(_ *Deps) map[string]Handler {
	return map[string]Handler{
		"ListDirectoryContents": func(p json.RawMessage) (any, error) {
			return filesystem.ListDirectory(argString(p, 0))
		},
		"ReadFile": func(p json.RawMessage) (any, error) {
			return filesystem.ReadFile(argString(p, 0))
		},
		"WriteFile": func(p json.RawMessage) (any, error) {
			return nil, filesystem.WriteFile(argString(p, 0), argString(p, 1))
		},
		"GetFileMetadata": func(p json.RawMessage) (any, error) {
			return filesystem.GetMetadata(argString(p, 0))
		},
		"SearchFiles": func(p json.RawMessage) (any, error) {
			return filesystem.Search(argString(p, 0), argString(p, 1))
		},
	}
}

func UsageHandlers(_ *Deps) map[string]Handler {
	return map[string]Handler{
		"GetUsageStats": func(p json.RawMessage) (any, error) {
			return usage.GetFormattedStats()
		},
		"GetUsageByDateRange": func(p json.RawMessage) (any, error) {
			return usage.GetFormattedStatsByDateRange(argString(p, 0), argString(p, 1))
		},
		"GetSessionStats": func(p json.RawMessage) (any, error) {
			return usage.GetSessionStats()
		},
		"GetUsageDetails": func(p json.RawMessage) (any, error) {
			return usage.GetUsageDetails(argInt(p, 0))
		},
	}
}

func MCPHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"ListMcpServers": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return []any{}, nil
			}
			return d.MCP.ListMcpServers()
		},
		"GetMcpServer": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return nil, nil
			}
			return d.MCP.GetMcpServer(argString(p, 0))
		},
		"SaveMcpServer": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return nil, nil
			}
			name := argString(p, 0)
			config := argObject[mcp.MCPServerConfig](p, 1)
			return nil, d.MCP.SaveMcpServer(name, &config)
		},
		"DeleteMcpServer": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return nil, nil
			}
			return nil, d.MCP.DeleteMcpServer(argString(p, 0))
		},
		"GetMcpServerStatus": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return nil, nil
			}
			return d.MCP.GetMcpServerStatus(argString(p, 0))
		},
		"McpAdd": func(p json.RawMessage) (any, error) {
			name := argString(p, 0)
			if d.MCP == nil {
				return map[string]any{"name": name, "success": false, "message": "MCP manager not initialized"}, nil
			}
			command := argString(p, 1)
			args := argObject[[]string](p, 2)
			env := argObject[map[string]string](p, 3)
			config := &mcp.MCPServerConfig{Command: command, Args: args, Env: env}
			if err := d.MCP.SaveMcpServer(name, config); err != nil {
				return map[string]any{"name": name, "success": false, "message": err.Error()}, nil
			}
			return map[string]any{"name": name, "success": true, "message": "MCP server added successfully"}, nil
		},
		"McpAddJson": func(p json.RawMessage) (any, error) {
			name := argString(p, 0)
			if d.MCP == nil {
				return map[string]any{"name": name, "success": false, "message": "MCP manager not initialized"}, nil
			}
			configJson := argString(p, 1)
			var config mcp.MCPServerConfig
			if err := json.Unmarshal([]byte(configJson), &config); err != nil {
				return map[string]any{"name": name, "success": false, "message": "Invalid JSON: " + err.Error()}, nil
			}
			if err := d.MCP.SaveMcpServer(name, &config); err != nil {
				return map[string]any{"name": name, "success": false, "message": err.Error()}, nil
			}
			return map[string]any{"name": name, "success": true, "message": "MCP server added from JSON"}, nil
		},
		"McpAddFromClaudeDesktop": func(p json.RawMessage) (any, error) {
			return mcpImportFromDesktop(d.MCP)
		},
		"McpTestConnection": func(p json.RawMessage) (any, error) {
			if d.MCP == nil {
				return "", fmt.Errorf("MCP manager not initialized")
			}
			return mcpTestConnection(d.MCP, argString(p, 0))
		},
		"McpReadProjectConfig": func(p json.RawMessage) (any, error) {
			return mcpReadProjectConfig(argString(p, 0))
		},
		"McpSaveProjectConfig": func(p json.RawMessage) (any, error) {
			projectPath := argString(p, 0)
			config := argObject[mcpProjectConfig](p, 1)
			return mcpSaveProjectConfig(projectPath, &config)
		},
	}
}

func MiscHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"CheckClaudeVersion": func(p json.RawMessage) (any, error) {
			cmd := exec.Command("claude", "--version")
			output, err := cmd.CombinedOutput()
			if err != nil {
				return map[string]any{"is_installed": false, "output": string(output)}, nil
			}
			version := strings.TrimSpace(string(output))
			return map[string]any{"is_installed": true, "version": version, "output": version}, nil
		},
		"ListClaudeInstallations": func(p json.RawMessage) (any, error) {
			// Simplified: just check PATH
			path, err := exec.LookPath("claude")
			if err != nil {
				return []any{}, nil
			}
			cmd := exec.Command(path, "--version")
			output, _ := cmd.CombinedOutput()
			version := strings.TrimSpace(string(output))
			return []map[string]any{{
				"path":              path,
				"version":           version,
				"source":            "system",
				"installation_type": "System",
			}}, nil
		},
		"SavePastedImage": func(p json.RawMessage) (any, error) {
			base64Data := argString(p, 0)
			filename := argString(p, 1)
			return savePastedImage(base64Data, filename)
		},
		"OpenInTerminal": func(p json.RawMessage) (any, error) {
			return nil, openin.Open(openin.DefaultTerminal(), argString(p, 0))
		},
		"OpenInEditor": func(p json.RawMessage) (any, error) {
			return nil, openin.Open(openin.AppVSCode, argString(p, 0))
		},
		"OpenInExternalApp": func(p json.RawMessage) (any, error) {
			return nil, openin.Open(openin.AppType(argString(p, 0)), argString(p, 1))
		},
		"ListOpenInApps": func(p json.RawMessage) (any, error) {
			items := openin.List()
			out := make([]string, len(items))
			for i, it := range items {
				out[i] = string(it)
			}
			return out, nil
		},
		"ExecuteCommand": func(p json.RawMessage) (any, error) {
			r := command.Execute(argString(p, 0), argString(p, 1))
			return map[string]any{"success": r.Success, "output": r.Output, "error": r.Error}, nil
		},
		"ExecuteCommandAsync": func(p json.RawMessage) (any, error) {
			cmd := argString(p, 0)
			args := argObject[[]string](p, 1)
			cwd := argString(p, 2)
			key := "async-" + cmd + "-" + strings.Join(args, "-")
			if d.Process != nil {
				d.Process.Spawn(key, cmd, args, cwd, nil)
			}
			return key, nil
		},
	}
}

// arg helpers for extracting typed params from JSON arrays

func argString(p json.RawMessage, i int) string {
	var args []json.RawMessage
	json.Unmarshal(p, &args)
	if i >= len(args) {
		return ""
	}
	var s string
	json.Unmarshal(args[i], &s)
	return s
}

// ArgString is the exported version for use outside the rpc package.
func ArgString(p json.RawMessage, i int) string { return argString(p, i) }

func argInt(p json.RawMessage, i int) int {
	var args []json.RawMessage
	json.Unmarshal(p, &args)
	if i >= len(args) {
		return 0
	}
	var n int
	json.Unmarshal(args[i], &n)
	return n
}

// ArgInt is the exported version for use outside the rpc package.
func ArgInt(p json.RawMessage, i int) int { return argInt(p, i) }

func argBool(p json.RawMessage, i int) bool {
	var args []json.RawMessage
	json.Unmarshal(p, &args)
	if i >= len(args) {
		return false
	}
	var b bool
	json.Unmarshal(args[i], &b)
	return b
}

func argObject[T any](p json.RawMessage, i int) T {
	var args []json.RawMessage
	json.Unmarshal(p, &args)
	var v T
	if i < len(args) {
		json.Unmarshal(args[i], &v)
	}
	return v
}

// --- MCP helpers ---

type mcpProjectConfig struct {
	Servers map[string]mcp.MCPServerConfig `json:"servers"`
}

func mcpImportFromDesktop(mgr *mcp.Manager) (any, error) {
	result := map[string]any{
		"success":        true,
		"imported_count": 0,
		"failed_count":   0,
		"messages":       []string{},
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		result["success"] = false
		result["messages"] = []string{"Failed to get home directory: " + err.Error()}
		return result, nil
	}

	configPath := filepath.Join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		result["success"] = false
		result["messages"] = []string{"Claude Desktop config not found at: " + configPath}
		return result, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		result["success"] = false
		result["messages"] = []string{"Failed to read config: " + err.Error()}
		return result, nil
	}

	var desktopConfig struct {
		McpServers map[string]struct {
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &desktopConfig); err != nil {
		result["success"] = false
		result["messages"] = []string{"Failed to parse config: " + err.Error()}
		return result, nil
	}

	var imported, failed int
	var messages []string
	for name, sc := range desktopConfig.McpServers {
		config := &mcp.MCPServerConfig{Command: sc.Command, Args: sc.Args, Env: sc.Env}
		if err := mgr.SaveMcpServer(name, config); err != nil {
			failed++
			messages = append(messages, fmt.Sprintf("Failed to import '%s': %s", name, err.Error()))
		} else {
			imported++
			messages = append(messages, fmt.Sprintf("Imported '%s'", name))
		}
	}

	result["imported_count"] = imported
	result["failed_count"] = failed
	result["messages"] = messages
	return result, nil
}

func mcpTestConnection(mgr *mcp.Manager, name string) (string, error) {
	server, err := mgr.GetMcpServer(name)
	if err != nil {
		return "", err
	}
	if server.Command == "" {
		return "Server has no command configured", nil
	}
	if _, err := exec.LookPath(server.Command); err != nil {
		return fmt.Sprintf("Command not found: %s", server.Command), nil
	}
	return fmt.Sprintf("Command '%s' is available", server.Command), nil
}

func mcpReadProjectConfig(projectPath string) (any, error) {
	configPath := filepath.Join(projectPath, ".claude", "mcp.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &mcpProjectConfig{Servers: make(map[string]mcp.MCPServerConfig)}, nil
		}
		return nil, err
	}
	var config mcpProjectConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	if config.Servers == nil {
		config.Servers = make(map[string]mcp.MCPServerConfig)
	}
	return &config, nil
}

func mcpSaveProjectConfig(projectPath string, config *mcpProjectConfig) (any, error) {
	configDir := filepath.Join(projectPath, ".claude")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", err
	}
	configPath := filepath.Join(configDir, "mcp.json")
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return "", err
	}
	return configPath, nil
}

func savePastedImage(base64Data, filename string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	tempImagesDir := filepath.Join(homeDir, ".ropcode", "temp-images")
	if err := os.MkdirAll(tempImagesDir, 0755); err != nil {
		return "", err
	}
	if filename == "" {
		timestamp := time.Now().Format("20060102-150405")
		uniqueID := uuid.New().String()[:8]
		filename = fmt.Sprintf("pasted-%s-%s.png", timestamp, uniqueID)
	}
	if idx := strings.Index(base64Data, ","); idx != -1 {
		base64Data = base64Data[idx+1:]
	}
	imageData, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	filePath := filepath.Join(tempImagesDir, filename)
	if err := os.WriteFile(filePath, imageData, 0644); err != nil {
		return "", err
	}
	return filePath, nil
}

// --- Claude Agents / GitHub Agents handlers ---

func ClaudeAgentsHandlers(d *Deps) map[string]Handler {
	return map[string]Handler{
		"ListClaudeAgents": func(p json.RawMessage) (any, error) {
			var entries []map[string]any
			agents, err := claude.ListClaudeConfigAgents("")
			if err == nil {
				for _, agent := range agents {
					entries = append(entries, map[string]any{
						"name": agent.Name, "path": agent.FilePath,
						"is_directory": false, "size": 0, "extension": ".md",
						"entry_type": "agent", "icon": "\U0001F916", "color": agent.Color,
					})
				}
			}
			homeDir, _ := os.UserHomeDir()
			if homeDir != "" && d.Plugin != nil {
				plugins, err := d.Plugin.ListInstalled()
				if err == nil {
					for _, pl := range plugins {
						pluginAgents, err := d.Plugin.ListAgents(pl.ID)
						if err == nil {
							for _, pa := range pluginAgents {
								entries = append(entries, map[string]any{
									"name": pa.PluginName + ":" + pa.Name, "path": pa.FilePath,
									"is_directory": false, "size": 0, "extension": ".md",
									"entry_type": "agent", "icon": "\U0001F50C", "color": pa.Color,
								})
							}
						}
					}
				}
			}
			return entries, nil
		},
		"SearchClaudeAgents": func(p json.RawMessage) (any, error) {
			query := strings.ToLower(argString(p, 0))
			var results []map[string]any
			agents, err := claude.ListClaudeConfigAgents("")
			if err == nil {
				for _, agent := range agents {
					if strings.Contains(strings.ToLower(agent.Name), query) ||
						strings.Contains(strings.ToLower(agent.Description), query) {
						results = append(results, map[string]any{
							"name": agent.Name, "path": agent.FilePath,
							"is_directory": false, "size": 0, "extension": ".md",
							"entry_type": "agent", "icon": "\U0001F916", "color": agent.Color,
						})
					}
				}
			}
			if d.Plugin != nil {
				plugins, _ := d.Plugin.ListInstalled()
				for _, pl := range plugins {
					pluginAgents, _ := d.Plugin.ListAgents(pl.ID)
					for _, pa := range pluginAgents {
						displayName := pa.PluginName + ":" + pa.Name
						if strings.Contains(strings.ToLower(pa.Name), query) ||
							strings.Contains(strings.ToLower(pa.PluginName), query) ||
							strings.Contains(strings.ToLower(displayName), query) {
							results = append(results, map[string]any{
								"name": displayName, "path": pa.FilePath,
								"is_directory": false, "size": 0, "extension": ".md",
								"entry_type": "agent", "icon": "\U0001F50C", "color": pa.Color,
							})
						}
					}
				}
			}
			return results, nil
		},
		"FetchGitHubAgents": func(p json.RawMessage) (any, error) {
			agents, err := github.FetchAgents(github.DefaultAgentsURL)
			if err != nil {
				return nil, err
			}
			result := make([]map[string]any, len(agents))
			for i, agent := range agents {
				result[i] = map[string]any{
					"name": agent.Name, "path": agent.Path,
					"download_url": agent.DownloadURL, "size": agent.Size, "sha": agent.SHA,
				}
			}
			return result, nil
		},
		"FetchGitHubAgentContent": func(p json.RawMessage) (any, error) {
			exportFile, err := github.FetchAgentExportFile(argString(p, 0))
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"version":     exportFile.Version,
				"exported_at": exportFile.ExportedAt,
				"agent": map[string]any{
					"name": exportFile.Agent.Name, "icon": exportFile.Agent.Icon,
					"model": exportFile.Agent.Model, "system_prompt": exportFile.Agent.SystemPrompt,
					"default_task": exportFile.Agent.DefaultTask,
				},
			}, nil
		},
		"ImportAgentFromGitHub": func(p json.RawMessage) (any, error) {
			if d.DB == nil {
				return nil, fmt.Errorf("database not initialized")
			}
			agentContent, err := github.FetchAgentContent(argString(p, 0))
			if err != nil {
				return nil, err
			}
			agent := &database.Agent{
				Name: agentContent.Name, Icon: agentContent.Icon,
				SystemPrompt: agentContent.SystemPrompt, DefaultTask: agentContent.DefaultTask,
				Model: agentContent.Model,
			}
			id, err := d.DB.CreateAgent(agent)
			if err != nil {
				return nil, err
			}
			agent.ID = id
			return agent, nil
		},
		"SaveClaudeAgent": func(p json.RawMessage) (any, error) {
			agent := argObject[claude.ClaudeAgent](p, 0)
			return nil, claude.SaveClaudeAgent(&agent, argString(p, 1))
		},
		"DeleteClaudeAgent": func(p json.RawMessage) (any, error) {
			return nil, claude.DeleteClaudeAgent(argString(p, 0), argString(p, 1), argString(p, 2))
		},
		"LoadSessionHistory": func(p json.RawMessage) (any, error) {
			if d.Provider == nil {
				return nil, fmt.Errorf("provider manager not initialized")
			}
			sessionID := argString(p, 0)
			projectID := argString(p, 1)
			return d.Provider.LoadSessionHistory("claude", projectID, sessionID)
		},
	}
}
