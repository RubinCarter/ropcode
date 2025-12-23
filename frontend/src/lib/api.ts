/**
 * API 模块
 *
 * 导出所有 RPC 客户端方法和事件监听器
 */

// 导出所有 RPC 方法
export * from './rpc-client';

// 导出事件函数
export { EventsOn, EventsOff, EventsEmit, EventsOnce } from './rpc-events';

// 类型别名：用于向后兼容
import type { ProjectIndex } from './rpc-client';
export type Project = ProjectIndex;

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
import { EventsOn, EventsOff } from './rpc-events';

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
      writeFile: 'WriteFile',
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
      listRunningAgentSessions: 'ListRunningAgentRuns',
      getAgentRun: 'GetAgentRun',
      executeAgent: 'ExecuteAgent',
      listAgentRuns: 'ListAgentRuns',
      deleteAgent: 'DeleteAgent',
      exportAgentToFile: 'ExportAgentToFile',
      importAgentFromFile: 'ImportAgentFromFile',
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
});

export { api };

// 导出 listen 函数（兼容旧代码）
export function listen(eventName: string, callback: (payload: any) => void): () => void {
  return EventsOn(eventName, callback);
}
