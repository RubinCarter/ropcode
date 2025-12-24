/**
 * RPC 客户端
 *
 * 提供 Go 后端方法的 WebSocket RPC 调用封装。
 * 所有方法都通过 WebSocket RPC 客户端调用后端。
 */

import { wsClient } from './ws-rpc-client';

// 通用类型定义
export type CommandType = 'claude' | 'codex';

// 类型定义 - 与 Go 后端保持一致
export namespace ssh {
  export interface SshConnection {
    name: string;
    host: string;
    port: number;
    user: string;
    identity_file?: string;
    password?: string;
    remote_path?: string;
  }
  export interface AutoSyncStatus {
    running: boolean;
    project_path: string;
    ssh_connection_name: string;
    branch: string;
    last_sync?: string;
  }
}

export namespace main {
  export interface PtySessionInfo { sessionId: string; pid: number; }
  export interface ProcessInfo { pid: string; sessionId: string; cmd: string; }
  export interface Action { name: string; description: string; command: string; }
  export interface ActionsResult { global: Action[]; project: Action[]; }
  export interface ClaudeVersionInfo { version: string; path: string; }
  export interface ClaudeInstallation { path: string; version: string; }
  export interface GitRepoStatus { branch: string; dirty: boolean; }
  export interface CloneRepositoryResult { success: boolean; path: string; }
  export interface WorktreeInfo { hasWorktree: boolean; mainBranch: string; }
  export interface FileEntry { name: string; path: string; isDir: boolean; }
  export interface MCPAddResult { success: boolean; message: string; }
  export interface MCPImportResult { imported: string[]; errors: string[]; }
  export interface MCPProjectConfig { mcpServers: Record<string, any>; }
  export interface ProviderSession { sessionId: string; conversationId: string; }
  export interface HookValidationResult { valid: boolean; error?: string; }
  export interface UsageStats { totalRequests: number; }
  export interface ClaudeAgentEntry { name: string; category: string; }
  export interface Skill { name: string; description: string; }
  export interface CommandResult { stdout: string; stderr: string; exitCode: number; }
}

export namespace database {
  export interface ProviderApiConfig {
    id?: string;
    provider_name: string;
    api_key?: string;
    base_url?: string;
    project_path?: string;
  }
  // ProviderInfo stores provider configuration for a project
  export interface ProviderInfo {
    id: string;
    provider_id: string;
    path: string;
    provider_api_id?: string;
  }
  // WorkspaceIndex stores workspace metadata
  export interface WorkspaceIndex {
    id: string;
    name: string;
    added_at: number;
    providers: ProviderInfo[];
    last_provider?: string;
    branch?: string;
  }
  // ProjectIndex stores project metadata (matches Go backend)
  export interface ProjectIndex {
    // Computed fields for frontend compatibility
    id: string;
    path: string;
    // Original backend fields
    name: string;
    added_at?: number;
    created_at?: number;
    last_accessed?: number;
    most_recent_session?: number;
    description?: string;
    available?: boolean;
    providers?: ProviderInfo[];
    workspaces?: WorkspaceIndex[];
    last_provider?: string;
    project_type?: string;
    has_git_support?: boolean;
    sessions?: any[];
  }
  export interface ModelConfig {
    id?: string;
    provider_name: string;
    model_id: string;
    enabled: boolean;
    is_default: boolean;
    thinking_levels?: ThinkingLevel[];
  }
  export interface ThinkingLevel {
    level: string;
    description: string;
    max_tokens: number;
  }
  export interface Agent {
    id: number;
    name: string;
    icon: string;
    system_prompt: string;
    default_task?: string;
    model: string;
    provider_api_id?: string;
    hooks?: string;
    created_at: string;
    updated_at: string;
  }
  export interface AgentRun {
    id: number;
    agent_id: number;
    agent_name: string;
    agent_icon: string;
    task: string;
    model: string;
    project_path: string;
    session_id: string;
    status: string;
    pid?: number;
    process_started_at?: string;
    created_at: string;
    completed_at?: string;
  }
  export interface TableData { columns: string[]; rows: any[][]; }
}

export namespace claude {
  export interface Message {
    role: string;
    content: string;
    timestamp?: string;
  }
  export interface SessionStatus {
    session_id: string;
    project_path: string;
    running: boolean;
    id?: string;
    project_id?: string;
  }
  export interface HooksConfig {
    preCommit?: HookMatcher[];
    postCommit?: HookMatcher[];
  }
  export interface HookMatcher {
    pattern: string;
    command: string;
    description?: string;
  }
  export interface SlashCommand {
    id: string;
    name: string;
    namespace: string | null;
    command: string;
    content: string;
    description: string;
    argument_hint: string | null;
    allowed_tools: string[] | null;
    command_type: 'claude' | 'codex';
    has_bash_commands: boolean;
    has_file_references: boolean;
    accepts_arguments: boolean;
    scope: 'project' | 'user' | 'plugin' | 'default';
  }
  export interface ClaudeAgent {
    category: string;
    name: string;
    description?: string;
    command?: string;
  }
  export interface ClaudeMdFile {
    path: string;
    type: string;
  }
}

export namespace mcp {
  export interface MCPServer {
    name: string;
    config: MCPServerConfig;
    enabled: boolean;
  }
  export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }
  export interface MCPServerStatus {
    running: boolean;
    healthy: boolean;
    error?: string;
  }
}

export namespace plugin {
  export interface PluginAuthor {
    name: string;
    email?: string;
  }
  export interface PluginMetadata {
    name: string;
    version: string;
    description: string;
    author?: PluginAuthor;
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
  }
  export interface Plugin {
    id: string;
    metadata: PluginMetadata;
    install_path: string;
    enabled: boolean;
    installed_at: string;
    // Extended fields from InstalledPluginRecord
    git_commit_sha?: string;
    is_local?: boolean;
    marketplace?: string;
  }
  export interface PluginContents {
    plugin: Plugin;
    agents: PluginAgent[];
    skills: PluginSkill[];
    commands: PluginCommand[];
    hooks: PluginHook[];
  }
  export interface PluginAgent {
    plugin_id: string;
    plugin_name: string;
    name: string;
    description: string;
    tools?: string;
    color?: string;
    model?: string;
    instructions: string;
    file_path: string;
  }
  export interface PluginSkill {
    plugin_id: string;
    plugin_name: string;
    name: string;
    description?: string;
    content: string;
    folder_path: string;
  }
  export interface PluginCommand {
    plugin_id: string;
    plugin_name: string;
    name: string;
    description?: string;
    allowed_tools?: string[];
    content: string;
    file_path: string;
    full_command: string;
  }
  export interface PluginHook {
    event_type: string;
    matcher?: string;
    command: string;
    plugin_id: string;
    plugin_name: string;
  }
}

// Plugin type aliases for convenience
export type InstalledPlugin = plugin.Plugin;
export type PluginContents = plugin.PluginContents;
export type PluginAgent = plugin.PluginAgent;
export type PluginSkill = plugin.PluginSkill;
export type PluginCommand = plugin.PluginCommand;
export type PluginHook = plugin.PluginHook;

// ==================== PTY 管理 ====================

export function CreatePtySession(sessionId: string, cwd: string, rows: number, cols: number, shell: string): Promise<main.PtySessionInfo> {
  return wsClient.call('CreatePtySession', sessionId, cwd, rows, cols, shell);
}

export function WriteToPty(sessionId: string, data: string): Promise<void> {
  return wsClient.call('WriteToPty', sessionId, data);
}

export function ResizePty(sessionId: string, rows: number, cols: number): Promise<void> {
  return wsClient.call('ResizePty', sessionId, rows, cols);
}

export function ClosePtySession(sessionId: string): Promise<void> {
  return wsClient.call('ClosePtySession', sessionId);
}

export function ListPtySessions(): Promise<string[]> {
  return wsClient.call('ListPtySessions');
}

export function IsPtySessionAlive(sessionId: string): Promise<boolean> {
  return wsClient.call('IsPtySessionAlive', sessionId);
}

// ==================== 进程管理 ====================

export function SpawnProcess(
  sessionId: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: string[]
): Promise<main.ProcessInfo> {
  return wsClient.call('SpawnProcess', sessionId, cmd, args, cwd, env);
}

export function KillProcess(pid: string): Promise<void> {
  return wsClient.call('KillProcess', pid);
}

export function IsProcessAlive(pid: string): Promise<boolean> {
  return wsClient.call('IsProcessAlive', pid);
}

export function ListProcesses(): Promise<string[]> {
  return wsClient.call('ListProcesses');
}

export function CleanupFinishedProcesses(): Promise<string[]> {
  return wsClient.call('CleanupFinishedProcesses');
}

export function KillCommand(sessionId: string): Promise<void> {
  return wsClient.call('KillCommand', sessionId);
}

// ==================== 窗口控制 ====================

export function ToggleFullscreen(): Promise<void> {
  return wsClient.call('ToggleFullscreen');
}

export function IsFullscreen(): Promise<boolean> {
  return wsClient.call('IsFullscreen');
}

// ==================== 配置管理 ====================

export function SaveSetting(key: string, value: string): Promise<void> {
  return wsClient.call('SaveSetting', key, value);
}

export function GetSetting(key: string): Promise<string> {
  return wsClient.call('GetSetting', key);
}

export function GetConfig(): Promise<Record<string, string>> {
  return wsClient.call('GetConfig');
}

export function GetHomeDirectory(): Promise<string> {
  return wsClient.call('GetHomeDirectory');
}

// ==================== Provider API 配置 ====================

export function CreateProviderApiConfig(config: database.ProviderApiConfig): Promise<void> {
  return wsClient.call('CreateProviderApiConfig', config);
}

export function UpdateProviderApiConfig(id: string, fields: Record<string, any>): Promise<database.ProviderApiConfig> {
  return wsClient.call('UpdateProviderApiConfig', id, fields);
}

export function DeleteProviderApiConfig(id: string): Promise<void> {
  return wsClient.call('DeleteProviderApiConfig', id);
}

export function GetProviderApiConfig(id: string): Promise<database.ProviderApiConfig> {
  return wsClient.call('GetProviderApiConfig', id);
}

export function GetAllProviderApiConfigs(): Promise<database.ProviderApiConfig[]> {
  return wsClient.call('GetAllProviderApiConfigs');
}

export function GetProjectProviderApiConfig(projectPath: string, providerName: string): Promise<database.ProviderApiConfig> {
  return wsClient.call('GetProjectProviderApiConfig', projectPath, providerName);
}

export function SetProjectProviderApiConfig(projectPath: string, providerName: string, configId: string): Promise<void> {
  return wsClient.call('SetProjectProviderApiConfig', projectPath, providerName, configId);
}

export function SaveProviderApiConfig(config: database.ProviderApiConfig): Promise<void> {
  return wsClient.call('SaveProviderApiConfig', config);
}

export function AddProviderToProject(projectPath: string, providerName: string): Promise<void> {
  return wsClient.call('AddProviderToProject', projectPath, providerName);
}

export function GetProviderSystemPrompt(providerName: string): Promise<string> {
  return wsClient.call('GetProviderSystemPrompt', providerName);
}

export function SaveProviderSystemPrompt(providerName: string, prompt: string): Promise<string> {
  return wsClient.call('SaveProviderSystemPrompt', providerName, prompt);
}

// ==================== 项目管理 ====================

export function ListProjects(): Promise<database.ProjectIndex[]> {
  return wsClient.call('ListProjects');
}

export function AddProjectToIndex(path: string): Promise<void> {
  return wsClient.call('AddProjectToIndex', path);
}

export function UpdateProjectAccessTime(path: string): Promise<void> {
  return wsClient.call('UpdateProjectAccessTime', path);
}

export function RemoveProjectFromIndex(path: string): Promise<void> {
  return wsClient.call('RemoveProjectFromIndex', path);
}

export function GetProjectIndex(path: string): Promise<database.ProjectIndex> {
  return wsClient.call('GetProjectIndex', path);
}

export function SaveProjectIndex(project: database.ProjectIndex): Promise<void> {
  return wsClient.call('SaveProjectIndex', project);
}

export function DeleteProjectIndex(path: string): Promise<void> {
  return wsClient.call('DeleteProjectIndex', path);
}

export function UpdateProjectFields(path: string, fields: Record<string, any>): Promise<void> {
  return wsClient.call('UpdateProjectFields', path, fields);
}

export function UpdateProjectLastProvider(path: string, provider: string): Promise<void> {
  return wsClient.call('UpdateProjectLastProvider', path, provider);
}

export function CreateProject(path: string): Promise<void> {
  return wsClient.call('CreateProject', path);
}

export function OpenNewSession(projectPath: string): Promise<string> {
  return wsClient.call('OpenNewSession', projectPath);
}

export function GetProjectSessions(projectPath: string): Promise<string[]> {
  return wsClient.call('GetProjectSessions', projectPath);
}

export function GetActions(projectPath: string, workspaceId: string): Promise<main.ActionsResult> {
  return wsClient.call('GetActions', projectPath, workspaceId);
}

export function UpdateProjectActions(projectPath: string, actions: main.Action[]): Promise<void> {
  return wsClient.call('UpdateProjectActions', projectPath, actions);
}

export function GetGlobalActions(): Promise<main.Action[]> {
  return wsClient.call('GetGlobalActions');
}

export function UpdateGlobalActions(actions: main.Action[]): Promise<void> {
  return wsClient.call('UpdateGlobalActions', actions);
}

// ==================== Workspace 管理 ====================

export function CreateWorkspace(projectPath: string, branch: string, sessionId: string): Promise<void> {
  return wsClient.call('CreateWorkspace', projectPath, branch, sessionId);
}

export function RemoveWorkspace(workspaceId: string): Promise<void> {
  return wsClient.call('RemoveWorkspace', workspaceId);
}

export function CleanupWorkspace(workspaceId: string): Promise<string> {
  return wsClient.call('CleanupWorkspace', workspaceId);
}

export function CheckWorkspaceClean(workspaceId: string): Promise<void> {
  return wsClient.call('CheckWorkspaceClean', workspaceId);
}

export function UpdateWorkspaceFields(workspaceId: string, fields: Record<string, any>): Promise<void> {
  return wsClient.call('UpdateWorkspaceFields', workspaceId, fields);
}

export function UpdateWorkspaceBranch(workspaceId: string, branch: string): Promise<void> {
  return wsClient.call('UpdateWorkspaceBranch', workspaceId, branch);
}

export function UpdateWorkspaceLastProvider(workspaceId: string, provider: string): Promise<void> {
  return wsClient.call('UpdateWorkspaceLastProvider', workspaceId, provider);
}

export function UpdateWorkspaceActions(workspaceId: string, actions: main.Action[]): Promise<void> {
  return wsClient.call('UpdateWorkspaceActions', workspaceId, actions);
}

// ==================== Claude 会话 ====================

export function ExecuteClaudeCode(
  projectPath: string,
  sessionId: string,
  prompt: string,
  thinkingLevel: string,
  agentId: string
): Promise<string> {
  return wsClient.call('ExecuteClaudeCode', projectPath, sessionId, prompt, thinkingLevel, agentId);
}

export function ContinueClaudeCode(
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId?: string
): Promise<string> {
  return wsClient.call('ContinueClaudeCode', projectPath, prompt, model, sessionId, providerApiId || '');
}

export function ResumeClaudeCode(
  projectPath: string,
  sessionId: string,
  prompt: string,
  model: string,
  _conversationId?: string,
  providerApiId?: string
): Promise<string> {
  return wsClient.call('ResumeClaudeCode', projectPath, prompt, model, sessionId, providerApiId || '');
}

export function CancelClaudeExecution(sessionId: string): Promise<void> {
  return wsClient.call('CancelClaudeExecution', sessionId);
}

export function CancelClaudeExecutionByProject(projectPath: string): Promise<void> {
  return wsClient.call('CancelClaudeExecutionByProject', projectPath);
}

export function StartProviderSession(
  provider: string,
  projectPath: string,
  prompt: string,
  model: string,
  providerApiId?: string
): Promise<string> {
  return wsClient.call('StartProviderSession', provider, projectPath, prompt, model, providerApiId || '');
}

export function ResumeProviderSession(
  provider: string,
  projectPath: string,
  prompt: string,
  model: string,
  sessionId: string,
  providerApiId?: string
): Promise<string> {
  return wsClient.call('ResumeProviderSession', provider, projectPath, prompt, model, sessionId, providerApiId || '');
}

export function UpdateProviderSession(projectPath: string, sessionId: string, thinkingLevel: string): Promise<void> {
  return wsClient.call('UpdateProviderSession', projectPath, sessionId, thinkingLevel);
}

export function ListProviderSessions(projectPath: string, providerName: string): Promise<main.ProviderSession[]> {
  return wsClient.call('ListProviderSessions', projectPath, providerName);
}

export function LoadSessionHistory(projectPath: string, sessionId: string): Promise<claude.Message[]> {
  return wsClient.call('LoadSessionHistory', projectPath, sessionId);
}

export function LoadProviderSessionHistory(
  projectPath: string,
  sessionId: string,
  providerName: string
): Promise<claude.Message[]> {
  return wsClient.call('LoadProviderSessionHistory', projectPath, sessionId, providerName);
}

export function StreamSessionOutput(projectPath: string, sessionId: string): Promise<void> {
  return wsClient.call('StreamSessionOutput', projectPath, sessionId);
}

export function GetClaudeSessionOutput(sessionId: string): Promise<string> {
  return wsClient.call('GetClaudeSessionOutput', sessionId);
}

export function GetSessionMessageIndex(projectPath: string, sessionId: string): Promise<number[]> {
  return wsClient.call('GetSessionMessageIndex', projectPath, sessionId);
}

export function GetSessionMessagesRange(
  projectPath: string,
  sessionId: string,
  start: number,
  end: number
): Promise<claude.Message[]> {
  return wsClient.call('GetSessionMessagesRange', projectPath, sessionId, start, end);
}

export function GetSessionStats(projectPath: string, sessionId: string): Promise<any[]> {
  return wsClient.call('GetSessionStats', projectPath, sessionId);
}

export function IsClaudeSessionRunning(sessionId: string): Promise<boolean> {
  return wsClient.call('IsClaudeSessionRunning', sessionId);
}

export function IsClaudeSessionRunningForProject(projectPath: string, sessionId: string): Promise<boolean> {
  return wsClient.call('IsClaudeSessionRunningForProject', projectPath, sessionId);
}

export function ListRunningClaudeSessions(): Promise<claude.SessionStatus[]> {
  return wsClient.call('ListRunningClaudeSessions');
}

// ==================== Claude 设置 ====================

export function GetClaudeSettings(): Promise<Record<string, any>> {
  return wsClient.call('GetClaudeSettings');
}

export function SaveClaudeSettings(settings: Record<string, any>): Promise<void> {
  return wsClient.call('SaveClaudeSettings', settings);
}

export function GetSystemPrompt(): Promise<string> {
  return wsClient.call('GetSystemPrompt');
}

export function SaveSystemPrompt(prompt: string): Promise<void> {
  return wsClient.call('SaveSystemPrompt', prompt);
}

export function GetClaudeBinaryPath(): Promise<string> {
  return wsClient.call('GetClaudeBinaryPath');
}

export function SetClaudeBinaryPath(path: string): Promise<void> {
  return wsClient.call('SetClaudeBinaryPath', path);
}

export function CheckClaudeVersion(): Promise<main.ClaudeVersionInfo> {
  return wsClient.call('CheckClaudeVersion');
}

export function ListClaudeInstallations(): Promise<main.ClaudeInstallation[]> {
  return wsClient.call('ListClaudeInstallations');
}

// ==================== Git 操作 ====================

export function GetGitStatus(projectPath: string): Promise<main.GitRepoStatus> {
  return wsClient.call('GetGitStatus', projectPath);
}

export function GetCurrentBranch(projectPath: string): Promise<string> {
  return wsClient.call('GetCurrentBranch', projectPath);
}

export function GetGitDiff(projectPath: string, cached: boolean): Promise<string> {
  return wsClient.call('GetGitDiff', projectPath, cached);
}

export function CloneRepository(url: string, path: string, projectName: string): Promise<main.CloneRepositoryResult> {
  return wsClient.call('CloneRepository', url, path, projectName);
}

export function IsGitRepository(path: string): Promise<boolean> {
  return wsClient.call('IsGitRepository', path);
}

export function InitLocalGit(projectPath: string, initialCommit: boolean): Promise<void> {
  return wsClient.call('InitLocalGit', projectPath, initialCommit);
}

export function GetUnpushedCommitsCount(projectPath: string): Promise<number> {
  return wsClient.call('GetUnpushedCommitsCount', projectPath);
}

export function GetUnpushedToRemoteCount(projectPath: string): Promise<number> {
  return wsClient.call('GetUnpushedToRemoteCount', projectPath);
}

export function PushToMainWorktree(projectPath: string): Promise<string> {
  return wsClient.call('PushToMainWorktree', projectPath);
}

export function PushToRemote(projectPath: string): Promise<string> {
  return wsClient.call('PushToRemote', projectPath);
}

export function WatchGitWorkspace(workspaceId: string): Promise<void> {
  return wsClient.call('WatchGitWorkspace', workspaceId);
}

export function UnwatchGitWorkspace(workspaceId: string): Promise<void> {
  return wsClient.call('UnwatchGitWorkspace', workspaceId);
}

export function DetectWorktree(projectPath: string): Promise<main.WorktreeInfo> {
  return wsClient.call('DetectWorktree', projectPath);
}

export function NotifyBranchRenamed(projectPath: string, oldBranch: string): Promise<void> {
  return wsClient.call('NotifyBranchRenamed', projectPath, oldBranch);
}

// ==================== 文件操作 ====================

export function ListDirectoryContents(path: string): Promise<main.FileEntry[]> {
  return wsClient.call('ListDirectoryContents', path);
}

export function ReadFile(path: string): Promise<string> {
  return wsClient.call('ReadFile', path);
}

export function WriteFile(path: string, content: string): Promise<void> {
  return wsClient.call('WriteFile', path, content);
}

export function SearchFiles(path: string, query: string): Promise<main.FileEntry[]> {
  return wsClient.call('SearchFiles', path, query);
}

export function OpenInEditor(path: string): Promise<void> {
  return wsClient.call('OpenInEditor', path);
}

export function OpenInExternalApp(path: string, app: string): Promise<void> {
  return wsClient.call('OpenInExternalApp', path, app);
}

export function OpenInTerminal(path: string): Promise<void> {
  return wsClient.call('OpenInTerminal', path);
}

export function OpenFileDialog(title: string, defaultPath: string, filters: any[]): Promise<string> {
  return wsClient.call('OpenFileDialog', title, defaultPath, filters);
}

export function OpenDirectoryDialog(title: string, defaultPath: string): Promise<string> {
  return wsClient.call('OpenDirectoryDialog', title, defaultPath);
}

export function SavePastedImage(projectPath: string, imageData: string): Promise<string> {
  return wsClient.call('SavePastedImage', projectPath, imageData);
}

// ==================== Model 配置 ====================

export function GetAllModelConfigs(): Promise<database.ModelConfig[]> {
  return wsClient.call('GetAllModelConfigs');
}

export function GetEnabledModelConfigs(): Promise<database.ModelConfig[]> {
  return wsClient.call('GetEnabledModelConfigs');
}

export function CreateModelConfig(config: database.ModelConfig): Promise<void> {
  return wsClient.call('CreateModelConfig', config);
}

export function UpdateModelConfig(id: string, config: database.ModelConfig): Promise<void> {
  return wsClient.call('UpdateModelConfig', id, config);
}

export function DeleteModelConfig(id: string): Promise<void> {
  return wsClient.call('DeleteModelConfig', id);
}

export function GetModelConfig(id: string): Promise<database.ModelConfig> {
  return wsClient.call('GetModelConfig', id);
}

export function GetModelConfigByModelID(modelId: string): Promise<database.ModelConfig> {
  return wsClient.call('GetModelConfigByModelID', modelId);
}

export function GetModelConfigsByProvider(providerName: string): Promise<database.ModelConfig[]> {
  return wsClient.call('GetModelConfigsByProvider', providerName);
}

export function GetDefaultModelConfig(providerName: string): Promise<database.ModelConfig> {
  return wsClient.call('GetDefaultModelConfig', providerName);
}

export function SetModelConfigDefault(id: string): Promise<void> {
  return wsClient.call('SetModelConfigDefault', id);
}

export function SetModelConfigEnabled(id: string, enabled: boolean): Promise<void> {
  return wsClient.call('SetModelConfigEnabled', id, enabled);
}

export function GetModelThinkingLevels(providerName: string): Promise<database.ThinkingLevel[]> {
  return wsClient.call('GetModelThinkingLevels', providerName);
}

export function GetDefaultThinkingLevel(providerName: string): Promise<database.ThinkingLevel> {
  return wsClient.call('GetDefaultThinkingLevel', providerName);
}

// ==================== Agent 管理 ====================

export function ListAgents(): Promise<database.Agent[]> {
  return wsClient.call('ListAgents');
}

export function CreateAgent(
  name: string,
  description: string,
  provider: string,
  model: string,
  thinkingLevel: string,
  systemPrompt: string,
  projectPath: string
): Promise<number> {
  return wsClient.call('CreateAgent', name, description, provider, model, thinkingLevel, systemPrompt, projectPath);
}

export function UpdateAgent(
  id: number,
  name: string,
  description: string,
  provider: string,
  model: string,
  thinkingLevel: string,
  systemPrompt: string
): Promise<void> {
  return wsClient.call('UpdateAgent', id, name, description, provider, model, thinkingLevel, systemPrompt);
}

export function DeleteAgent(id: number): Promise<void> {
  return wsClient.call('DeleteAgent', id);
}

export function GetAgent(id: number): Promise<database.Agent> {
  return wsClient.call('GetAgent', id);
}

export function ExecuteAgent(agentId: number, projectPath: string, sessionId: string, prompt: string): Promise<database.AgentRun> {
  return wsClient.call('ExecuteAgent', agentId, projectPath, sessionId, prompt);
}

export function ListAgentRuns(agentId: number, limit: number): Promise<database.AgentRun[]> {
  return wsClient.call('ListAgentRuns', agentId, limit);
}

export function ListRunningAgentRuns(): Promise<database.AgentRun[]> {
  return wsClient.call('ListRunningAgentRuns');
}

export function GetAgentRun(id: number): Promise<database.AgentRun> {
  return wsClient.call('GetAgentRun', id);
}

export function GetAgentRunBySessionID(sessionId: string): Promise<database.AgentRun> {
  return wsClient.call('GetAgentRunBySessionID', sessionId);
}

export function GetAgentRunOutput(id: number): Promise<string> {
  return wsClient.call('GetAgentRunOutput', id);
}

export function DeleteAgentRun(id: number): Promise<void> {
  return wsClient.call('DeleteAgentRun', id);
}

export function CancelAgentRun(id: number): Promise<void> {
  return wsClient.call('CancelAgentRun', id);
}

export function ExportAgent(id: number): Promise<string> {
  return wsClient.call('ExportAgent', id);
}

export function ExportAgentToFile(id: number, filePath: string): Promise<void> {
  return wsClient.call('ExportAgentToFile', id, filePath);
}

export function ImportAgent(jsonData: string): Promise<database.Agent> {
  return wsClient.call('ImportAgent', jsonData);
}

export function ImportAgentFromFile(filePath: string): Promise<database.Agent> {
  return wsClient.call('ImportAgentFromFile', filePath);
}

export function ImportAgentFromGitHub(url: string): Promise<database.Agent> {
  return wsClient.call('ImportAgentFromGitHub', url);
}

export function FetchGitHubAgents(): Promise<any[]> {
  return wsClient.call('FetchGitHubAgents');
}

export function FetchGitHubAgentContent(url: string): Promise<any> {
  return wsClient.call('FetchGitHubAgentContent', url);
}

export function LoadAgentSessionHistory(sessionId: string): Promise<claude.Message[]> {
  return wsClient.call('LoadAgentSessionHistory', sessionId);
}

// ==================== MCP 管理 ====================

export function ListMcpServers(): Promise<mcp.MCPServer[]> {
  return wsClient.call('ListMcpServers');
}

export function GetMcpServer(name: string): Promise<mcp.MCPServer> {
  return wsClient.call('GetMcpServer', name);
}

export function SaveMcpServer(name: string, config: mcp.MCPServerConfig): Promise<void> {
  return wsClient.call('SaveMcpServer', name, config);
}

export function DeleteMcpServer(name: string): Promise<void> {
  return wsClient.call('DeleteMcpServer', name);
}

export function McpAdd(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  projectPath: string
): Promise<main.MCPAddResult> {
  return wsClient.call('McpAdd', name, command, args, env, projectPath);
}

export function McpAddJson(name: string, jsonConfig: string): Promise<main.MCPAddResult> {
  return wsClient.call('McpAddJson', name, jsonConfig);
}

export function McpAddFromClaudeDesktop(projectPath: string): Promise<main.MCPImportResult> {
  return wsClient.call('McpAddFromClaudeDesktop', projectPath);
}

export function McpTestConnection(name: string): Promise<string> {
  return wsClient.call('McpTestConnection', name);
}

export function McpServe(): Promise<string> {
  return wsClient.call('McpServe');
}

export function McpReadProjectConfig(projectPath: string): Promise<main.MCPProjectConfig> {
  return wsClient.call('McpReadProjectConfig', projectPath);
}

export function McpSaveProjectConfig(projectPath: string, config: main.MCPProjectConfig): Promise<string> {
  return wsClient.call('McpSaveProjectConfig', projectPath, config);
}

export function McpResetProjectChoices(): Promise<string> {
  return wsClient.call('McpResetProjectChoices');
}

export function GetMcpServerStatus(name: string): Promise<mcp.MCPServerStatus> {
  return wsClient.call('GetMcpServerStatus', name);
}

// ==================== Hooks ====================

export function GetHooks(): Promise<claude.HooksConfig> {
  return wsClient.call('GetHooks');
}

export function SaveHooks(hooks: claude.HooksConfig): Promise<void> {
  return wsClient.call('SaveHooks', hooks);
}

export function GetHooksByType(type: string): Promise<claude.HookMatcher[]> {
  return wsClient.call('GetHooksByType', type);
}

export function GetMergedHooksConfig(projectPath: string): Promise<claude.HooksConfig> {
  return wsClient.call('GetMergedHooksConfig', projectPath);
}

export function ValidateHookCommand(command: string): Promise<main.HookValidationResult> {
  return wsClient.call('ValidateHookCommand', command);
}

// ==================== Slash Commands ====================

export function ListSlashCommands(projectPath: string): Promise<claude.SlashCommand[]> {
  return wsClient.call('ListSlashCommands', projectPath);
}

export function GetSlashCommand(projectPath: string, name: string): Promise<claude.SlashCommand> {
  return wsClient.call('GetSlashCommand', projectPath, name);
}

export function SaveSlashCommand(projectPath: string, name: string, command: string, description: string): Promise<void> {
  return wsClient.call('SaveSlashCommand', projectPath, name, command, description);
}

export function DeleteSlashCommand(projectPath: string, name: string, command: string): Promise<void> {
  return wsClient.call('DeleteSlashCommand', projectPath, name, command);
}

// ==================== SSH 管理 ====================

export function ListGlobalSshConnections(): Promise<ssh.SshConnection[]> {
  return wsClient.call('ListGlobalSshConnections');
}

export function AddGlobalSshConnection(conn: ssh.SshConnection): Promise<void> {
  return wsClient.call('AddGlobalSshConnection', conn);
}

export function DeleteGlobalSshConnection(name: string): Promise<void> {
  return wsClient.call('DeleteGlobalSshConnection', name);
}

export function TestSshConnection(conn: ssh.SshConnection): Promise<void> {
  return wsClient.call('TestSshConnection', conn);
}

export function SyncFromSSH(projectPath: string, sshConnectionName: string, branch: string): Promise<void> {
  return wsClient.call('SyncFromSSH', projectPath, sshConnectionName, branch);
}

export function SyncToSSH(projectPath: string, sshConnectionName: string, branch: string): Promise<void> {
  return wsClient.call('SyncToSSH', projectPath, sshConnectionName, branch);
}

export function StartAutoSync(projectPath: string, sshConnectionName: string, branch: string): Promise<void> {
  return wsClient.call('StartAutoSync', projectPath, sshConnectionName, branch);
}

export function StopAutoSync(): Promise<void> {
  return wsClient.call('StopAutoSync');
}

export function PauseSshSync(projectPath: string): Promise<void> {
  return wsClient.call('PauseSshSync', projectPath);
}

export function ResumeSshSync(projectPath: string): Promise<void> {
  return wsClient.call('ResumeSshSync', projectPath);
}

export function CancelSshSync(projectPath: string): Promise<void> {
  return wsClient.call('CancelSshSync', projectPath);
}

export function GetAutoSyncStatus(projectPath: string): Promise<ssh.AutoSyncStatus> {
  return wsClient.call('GetAutoSyncStatus', projectPath);
}

// ==================== Plugin ====================

export function ListInstalledPlugins(): Promise<plugin.Plugin[]> {
  return wsClient.call('ListInstalledPlugins');
}

export function GetPluginDetails(name: string): Promise<plugin.Plugin> {
  return wsClient.call('GetPluginDetails', name);
}

export function GetPluginContents(name: string): Promise<plugin.PluginContents> {
  return wsClient.call('GetPluginContents', name);
}

export function GetPluginAgent(pluginName: string, agentName: string): Promise<plugin.PluginAgent> {
  return wsClient.call('GetPluginAgent', pluginName, agentName);
}

export function GetPluginSkill(pluginName: string, skillName: string): Promise<plugin.PluginSkill> {
  return wsClient.call('GetPluginSkill', pluginName, skillName);
}

export function GetPluginCommand(pluginName: string, commandName: string): Promise<plugin.PluginCommand> {
  return wsClient.call('GetPluginCommand', pluginName, commandName);
}

export function ListPluginAgents(pluginName: string): Promise<plugin.PluginAgent[]> {
  return wsClient.call('ListPluginAgents', pluginName);
}

export function ListPluginSkills(pluginName: string): Promise<plugin.PluginSkill[]> {
  return wsClient.call('ListPluginSkills', pluginName);
}

export function ListPluginCommands(pluginName: string): Promise<plugin.PluginCommand[]> {
  return wsClient.call('ListPluginCommands', pluginName);
}

export function ListPluginHooks(pluginName: string): Promise<plugin.PluginHook[]> {
  return wsClient.call('ListPluginHooks', pluginName);
}

// ==================== Usage ====================

export function GetUsageStats(): Promise<main.UsageStats> {
  return wsClient.call('GetUsageStats');
}

export function GetUsageByDateRange(startDate: string, endDate: string): Promise<main.UsageStats> {
  return wsClient.call('GetUsageByDateRange', startDate, endDate);
}

export function GetUsageDetails(id: number): Promise<any[]> {
  return wsClient.call('GetUsageDetails', id);
}

// ==================== Storage ====================

export function StorageListTables(): Promise<string[]> {
  return wsClient.call('StorageListTables');
}

export function StorageReadTable(tableName: string, offset: number, limit: number): Promise<database.TableData> {
  return wsClient.call('StorageReadTable', tableName, offset, limit);
}

export function StorageInsertRow(tableName: string, row: Record<string, any>): Promise<number> {
  return wsClient.call('StorageInsertRow', tableName, row);
}

export function StorageUpdateRow(tableName: string, rowId: number, row: Record<string, any>): Promise<void> {
  return wsClient.call('StorageUpdateRow', tableName, rowId, row);
}

export function StorageDeleteRow(tableName: string, rowId: number): Promise<void> {
  return wsClient.call('StorageDeleteRow', tableName, rowId);
}

export function StorageExecuteSql(sql: string): Promise<database.TableData> {
  return wsClient.call('StorageExecuteSql', sql);
}

export function StorageResetDatabase(): Promise<void> {
  return wsClient.call('StorageResetDatabase');
}

// ==================== Claude 配置 Agents ====================

export function ListClaudeConfigAgents(projectPath: string): Promise<claude.ClaudeAgent[]> {
  return wsClient.call('ListClaudeConfigAgents', projectPath);
}

export function GetClaudeConfigAgent(projectPath: string, category: string, name: string): Promise<claude.ClaudeAgent> {
  return wsClient.call('GetClaudeConfigAgent', projectPath, category, name);
}

export function SaveClaudeConfigAgent(agent: claude.ClaudeAgent, projectPath: string): Promise<void> {
  return wsClient.call('SaveClaudeConfigAgent', agent, projectPath);
}

export function DeleteClaudeConfigAgent(projectPath: string, category: string, name: string): Promise<void> {
  return wsClient.call('DeleteClaudeConfigAgent', projectPath, category, name);
}

// ==================== Claude.md 文件 ====================

export function FindClaudeMdFiles(projectPath: string): Promise<claude.ClaudeMdFile[]> {
  return wsClient.call('FindClaudeMdFiles', projectPath);
}

export function ReadClaudeMdFile(path: string): Promise<string> {
  return wsClient.call('ReadClaudeMdFile', path);
}

export function SaveClaudeMdFile(path: string, content: string): Promise<void> {
  return wsClient.call('SaveClaudeMdFile', path, content);
}

// ==================== Claude Agents (外部) ====================

export function ListClaudeAgents(): Promise<main.ClaudeAgentEntry[]> {
  return wsClient.call('ListClaudeAgents');
}

export function SearchClaudeAgents(query: string): Promise<main.ClaudeAgentEntry[]> {
  return wsClient.call('SearchClaudeAgents', query);
}

// ==================== Skills ====================

export function SkillsList(projectPath: string): Promise<main.Skill[]> {
  return wsClient.call('SkillsList', projectPath);
}

export function SkillGet(projectPath: string, skillName: string): Promise<main.Skill> {
  return wsClient.call('SkillGet', projectPath, skillName);
}

// ==================== 命令执行 ====================

export function ExecuteCommand(cwd: string, command: string): Promise<main.CommandResult> {
  return wsClient.call('ExecuteCommand', cwd, command);
}

export function ExecuteCommandWithArgs(cwd: string, args: string[], env: string): Promise<string> {
  return wsClient.call('ExecuteCommandWithArgs', cwd, args, env);
}

export function ExecuteCommandAsync(cwd: string, args: string[], env: string): Promise<string> {
  return wsClient.call('ExecuteCommandAsync', cwd, args, env);
}

// ==================== 其他工具 ====================

export function OpenUrl(url: string): Promise<void> {
  return wsClient.call('OpenUrl', url);
}

export function Greet(name: string): Promise<string> {
  return wsClient.call('Greet', name);
}
