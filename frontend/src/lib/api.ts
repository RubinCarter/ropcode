/**
 * API Module
 *
 * Exports all RPC client methods and event listeners.
 */

// Export all RPC methods
export * from './rpc-client';

// Type aliases for backward compatibility
import type { ProviderCapability, ProviderCapabilityLayers, database, claude, main, mcp } from './rpc-client';
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
export type ProviderSessionSummary = main.ProviderSessionSummary;
export type SpaceSessionsResult = main.SpaceSessionsResult;
export type ProviderApiConfig = database.ProviderApiConfig;
export type Action = main.Action;
export type ActionsResult = main.ActionsResult;
export type ProviderCapabilityItem = ProviderCapability;
export type ProviderCapabilityLayersResult = ProviderCapabilityLayers;
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

// Export event functions
export { EventsOn, EventsOff, EventsEmit, EventsOnce } from './rpc-events';

// Export window control functions
export {
  WindowMinimise,
  WindowToggleMaximise,
  WindowMaximise,
  WindowUnmaximise,
  WindowHide as CloseWindow,
  Quit
} from './rpc-window';

// Create convenience api object (for backward compatibility with existing code)
import * as rpcMethods from './rpc-client';
import { EventsOn } from './rpc-events';

// Export all methods as properties with auto-added lowercase aliases
const api = new Proxy({ ...rpcMethods }, {
  get(target, prop) {
    // If property exists, return directly
    if (prop in target) {
      return target[prop];
    }

    // Try converting lowercase property name to uppercase form
    const key = String(prop);

    // PascalCase conversion
    const pascalCase = key.charAt(0).toUpperCase() + key.slice(1);

    if (pascalCase in target) {
      return target[pascalCase];
    }

    // Try other common naming conversions
    // Add prefix like "Get" or "List"
    const withGet = 'Get' + pascalCase;
    if (withGet in target) {
      return target[withGet];
    }

    const withList = 'List' + pascalCase.replace(/^List/, '');
    if (withList in target && key.startsWith('list')) {
      return target[withList];
    }

    // Handle some special naming patterns
    const mappings: Record<string, string> = {
      // SSH related
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
      getAgentRunWithRealTimeMetrics: 'GetAgentRun',
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
      stopProviderSessionsByProject: 'StopProviderSessionsByProject',
      setProviderSessionModel: 'SetProviderSessionModel',
      setProviderSessionPermissionMode: 'SetProviderSessionPermissionMode',
      interruptProviderSession: 'InterruptProviderSession',
      updateProviderSessionEnvironment: 'UpdateProviderSessionEnvironment',
      switchProviderSessionApi: 'SwitchProviderSessionApi',
      isProviderSessionRunningForProject: 'IsProviderSessionRunningForProject',
      queryProviderSessionActivityForProject: 'QueryProviderSessionActivityForProject',
      getSetting: 'GetSetting',
      generateSessionTitle: 'GenerateSessionTitle',
      // Plugin
      listInstalledPlugins: 'ListInstalledPlugins',
      getPluginContents: 'GetPluginContents',
      // Model
      getAllModelConfigs: 'GetAllModelConfigs',
      syncProviderModelsFromAPI: 'SyncProviderModelsFromAPI',
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
      getSessionOutput: 'GetProviderSessionOutput',
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

// Export listen function (backward compatibility)
export function listen(eventName: string, callback: (payload: any) => void): () => void {
  return EventsOn(eventName, callback);
}
