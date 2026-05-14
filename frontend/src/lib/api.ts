/**
 * API 模块
 *
 * 导出所有 RPC 客户端方法和事件监听器
 */

// 导出所有 RPC 方法
export * from './rpc-client';

// 类型别名：用于向后兼容
import type { ClaudeCapability, ClaudeCapabilityLayers, database, claude, main, mcp } from './rpc-client';
export type Agent = database.Agent;
export type AgentRunMetrics = database.AgentRunMetrics;
export type AgentRun = database.AgentRun;
export type Project = database.ProjectIndex;
export type AgentRunWithMetrics = database.AgentRun;
export type Session = claude.SessionStatus;
export type ClaudeAgent = claude.ClaudeAgent;
export type ClaudeMdFile = claude.ClaudeMdFile;
export type SlashCommand = claude.SlashCommand;
export type ClaudeInstallation = main.ClaudeInstallation;
export type ProviderSession = main.ProviderSession;
export type ProviderApiConfig = database.ProviderApiConfig;
export type Action = main.Action;
export type ActionsResult = main.ActionsResult;
export type ClaudeCapabilityItem = ClaudeCapability;
export type ClaudeCapabilityLayersResult = ClaudeCapabilityLayers;
export interface FileEntry extends main.FileEntry {
  entry_type?: string;
  color?: string;
  icon?: string;
  [key: string]: any;
}
export interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  env?: Record<string, string>;
  [key: string]: any;
}
export interface ClaudeVersionStatus {
  is_installed: boolean;
  version?: string;
  output: string;
  [key: string]: any;
}
export interface UsageStats {
  totalRequests?: number;
  total_cost?: number;
  total_sessions?: number;
  total_tokens?: number;
  by_model?: Array<{
    model: string;
    session_count: number;
    total_cost?: number;
    [key: string]: any;
  }>;
  by_project?: Array<{
    project_path?: string;
    session_count: number;
    total_cost?: number;
    [key: string]: any;
  }>;
  by_date?: Array<{
    date: string;
    total_cost?: number;
    total_tokens?: number;
    models_used?: string[];
    [key: string]: any;
  }>;
  [key: string]: any;
}
export interface ProjectUsage {
  [key: string]: any;
}
export type SSHAuthMethod =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; keyPath: string; passphrase?: string };
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authMethod: SSHAuthMethod;
  remotePath: string;
  localPath: string;
  skipPatterns?: string[];
  connectionName?: string;
  syncDirection?: 'pull' | 'push';
  autoSyncDirection?: 'local-priority' | 'bidirectional';
  [key: string]: any;
}
export interface SSHSyncProgress {
  syncId?: string;
  stage: 'connecting' | 'authenticating' | 'downloading' | 'completed' | 'error';
  filesProcessed: number;
  totalFiles: number;
  percentage: number;
  currentFile?: string;
  direction?: 'upload' | 'download';
  bytesDownloaded: number;
  totalBytes: number;
  isPaused?: boolean;
  error?: string;
  [key: string]: any;
}
export interface MessageIndex {
  line_number: number;
  byte_offset: number;
  byte_length: number;
  timestamp?: string;
  message_type?: string;
  [key: string]: any;
}
export type ModelConfig = database.ModelConfig;
export type ThinkingLevel = database.ThinkingLevel;
export type ProcessInfo = main.ProcessInfo;
export type MCPServer = mcp.MCPServer;
export interface GitCloneProgress { [key: string]: any; }
export interface GitHubAgentFile { [key: string]: any; }
export interface AgentExport { [key: string]: any; }

// 导出事件函数
export { EventsOn, EventsOff, EventsEmit, EventsOnce } from './rpc-events';

// 导出窗口控制函数
export {
  WindowMinimise,
  WindowToggleMaximise,
  WindowMaximise,
  WindowUnmaximise,
  WindowHide as CloseWindow,
  Quit
} from './rpc-window';

// 创建便捷的 api 对象（用于兼容现有代码）
import * as rpcMethods from './rpc-client';
import { EventsOn } from './rpc-events';

// 将所有方法作为属性导出，并自动添加小写别名
const api = new Proxy({ ...rpcMethods }, {
  get(target, prop) {
    // 如果属性存在，直接返回
    if (prop in target) {
      return target[prop];
    }

    // 尝试将小写属性名转换为大写形式
    const key = String(prop);

    // 首字母大写的驼峰命名
    const pascalCase = key.charAt(0).toUpperCase() + key.slice(1);

    if (pascalCase in target) {
      return target[pascalCase];
    }

    // 尝试其他常见的命名转换
    // 添加前缀 "Get" 或 "List" 等
    const withGet = 'Get' + pascalCase;
    if (withGet in target) {
      return target[withGet];
    }

    const withList = 'List' + pascalCase.replace(/^List/, '');
    if (withList in target && key.startsWith('list')) {
      return target[withList];
    }

    // 处理一些特殊的命名模式
    const mappings: Record<string, string> = {
      // SSH 相关
      listGlobalSshConnections: 'ListGlobalSshConnections',
      getHomeDirectory: 'GetHomeDirectory',
      syncFromSSH: 'SyncFromSSH',
      initLocalGit: 'InitLocalGit',
      startAutoSync: 'StartAutoSync',
      cancelSshSync: 'CancelSshSync',
      pauseSshSync: 'PauseSshSync',
      resumeSshSync: 'ResumeSshSync',
      // Provider API
      listProviderApiConfigs: 'GetAllProviderApiConfigs',
      getProjectProviderApiConfig: 'GetProjectProviderApiConfig',
      setProjectProviderApiConfig: 'SetProjectProviderApiConfig',
      // Agent
      getAgentRunWithRealTimeMetrics: 'GetAgentRunOutput',
      loadAgentSessionHistory: 'LoadAgentSessionHistory',
      killAgentSession: 'CancelAgentRun',
      listAgentRunsWithMetrics: 'ListRunningAgentRuns',
      listAgents: 'ListAgents',
      listAgentRuns: 'ListAgentRuns',
      exportAgent: 'ExportAgent',
      importAgentFromFile: 'ImportAgentFromFile',
      exportAgentToFile: 'ExportAgentToFile',
      deleteAgent: 'DeleteAgent',
      getAgentRun: 'GetAgentRun',
      listRunningAgentSessions: 'ListRunningAgentRuns',
      // Session
      updateProviderSession: 'UpdateProviderSession',
      resumeClaudeCode: 'ResumeClaudeCode',
      resumeProviderSession: 'ResumeProviderSession',
      executeClaudeCode: 'ExecuteClaudeCode',
      startProviderSession: 'StartProviderSession',
      cancelClaudeExecutionByProject: 'CancelClaudeExecutionByProject',
      startInteractiveClaudeSession: 'StartInteractiveClaudeSession',
      sendClaudeMessage: 'SendClaudeMessage',
      isClaudeSessionRunningForProject: 'IsClaudeSessionRunningForProject',
      getSetting: 'GetSetting',
      // Plugin
      listInstalledPlugins: 'ListInstalledPlugins',
      getPluginContents: 'GetPluginContents',
      // Model
      getAllModelConfigs: 'GetAllModelConfigs',
      createModelConfig: 'CreateModelConfig',
      deleteModelConfig: 'DeleteModelConfig',
      setModelConfigEnabled: 'SetModelConfigEnabled',
      setModelConfigDefault: 'SetModelConfigDefault',
      // File operations
      executeCommand: 'ExecuteCommand',
      readFile: 'ReadFile',
      writeFile: 'WriteFile',
      getFileMetadata: 'GetFileMetadata',
      readGitFileAtHead: 'ReadGitFileAtHead',
      // Hooks
      getHooksConfig: 'GetHooks',
      updateHooksConfig: 'SaveHooks',
      // Slash commands
      slashCommandsList: 'ListSlashCommands',
      slashCommandSave: 'SaveSlashCommand',
      slashCommandDelete: 'DeleteSlashCommand',
      // Session
      getSessionOutput: 'GetClaudeSessionOutput',
      loadSessionHistory: 'LoadSessionHistory',
      loadSubagentTranscripts: 'LoadSubagentTranscripts',
      // Git
      isGitRepository: 'IsGitRepository',
      getCurrentBranch: 'GetCurrentBranch',
      detectWorktree: 'DetectWorktree',
      getUnpushedCommitsCount: 'GetUnpushedCommitsCount',
      getUnpushedToRemoteCount: 'GetUnpushedToRemoteCount',
      pushToMainWorktree: 'PushToMainWorktree',
      pushToRemote: 'PushToRemote',
      cleanupWorkspace: 'CleanupWorkspace',
      openInExternalApp: 'OpenInExternalApp',
      streamSessionOutput: 'StreamSessionOutput',
      // MCP
      mcpList: 'ListMcpServers',
      mcpAdd: 'McpAdd',
      mcpAddJson: 'McpAddJson',
      mcpAddFromClaudeDesktop: 'McpAddFromClaudeDesktop',
      mcpRemove: 'DeleteMcpServer',
      mcpTestConnection: 'McpTestConnection',
      mcpServe: 'McpServe',
      // Project
      createProject: 'CreateProject',
      addProjectToIndex: 'AddProjectToIndex',
      // Storage
      storageListTables: 'StorageListTables',
      storageReadTable: 'StorageReadTable',
      storageUpdateRow: 'StorageUpdateRow',
      storageDeleteRow: 'StorageDeleteRow',
      storageInsertRow: 'StorageInsertRow',
      storageExecuteSql: 'StorageExecuteSql',
      storageResetDatabase: 'StorageResetDatabase',
      // Skills
      skillsList: 'SkillsList',
      // Workspace
      createWorkspace: 'CreateWorkspace',
      updateWorkspaceFields: 'UpdateWorkspaceFields',
      // Actions
      getActions: 'GetActions',
      updateGlobalActions: 'UpdateGlobalActions',
      updateProjectActions: 'UpdateProjectActions',
      updateWorkspaceActions: 'UpdateWorkspaceActions',
      // Claude
      listClaudeInstallations: 'ListClaudeInstallations',
      listClaudeAgents: 'ListClaudeAgents',
      readClaudeMdFile: 'ReadClaudeMdFile',
      saveClaudeMdFile: 'SaveClaudeMdFile',
      checkClaudeVersion: 'CheckClaudeVersion',
      fetchGitHubAgents: 'FetchGitHubAgents',
      fetchGitHubAgentContent: 'FetchGitHubAgentContent',
      importAgentFromGitHub: 'ImportAgentFromGitHub',
      listClaudeConfigAgents: 'ListClaudeConfigAgents',
      listPluginAgents: 'ListPluginAgents',
      saveClaudeAgent: 'SaveClaudeAgent',
      deleteClaudeAgent: 'DeleteClaudeAgent',
      // PTY
      createPtySession: 'CreatePtySession',
      resizePty: 'ResizePty',
      closePtySession: 'ClosePtySession',
      writeToPty: 'WriteToPty',
      // Other
      savePastedImage: 'SavePastedImage',
      listDirectoryContents: 'ListDirectoryContents',
      searchFiles: 'SearchFiles',
      searchClaudeAgents: 'SearchClaudeAgents',
      updateAgent: 'UpdateAgent',
      createAgent: 'CreateAgent',
      getProjectSessions: 'GetProjectSessions',
      getClaudeBinaryPath: 'GetClaudeBinaryPath',
      setClaudeBinaryPath: 'SetClaudeBinaryPath',
      getClaudeSettings: 'GetClaudeSettings',
      saveClaudeSettings: 'SaveClaudeSettings',
      getProviderSystemPrompt: 'GetProviderSystemPrompt',
      saveProviderSystemPrompt: 'SaveProviderSystemPrompt',
      updateProviderApiConfig: 'UpdateProviderApiConfig',
      createProviderApiConfig: 'CreateProviderApiConfig',
      deleteProviderApiConfig: 'DeleteProviderApiConfig',
    };

    if (key in mappings && mappings[key] in target) {
      return target[mappings[key]];
    }

    return undefined;
  }
}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

export { api };

// 导出 listen 函数（兼容旧代码）
export function listen(eventName: string, callback: (payload: any) => void): () => void {
  return EventsOn(eventName, callback);
}
