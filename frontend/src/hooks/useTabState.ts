import { useCallback, useMemo } from 'react';
import { useTabContext } from '@/contexts/TabContext';
import { Tab } from '@/contexts/TabContext';

interface UseTabStateReturn {
  // State
  tabs: Tab[];
  activeTab: Tab | undefined;
  activeTabId: string | null;
  tabCount: number;
  chatTabCount: number;
  agentTabCount: number;

  // Operations
  createChatTab: (projectId?: string, title?: string, projectPath?: string, providerId?: string, sessionData?: any) => string;
  createAgentTab: (agentRunId: string, agentName: string, projectPath?: string) => string;
  createAgentExecutionTab: (agent: any, tabId: string, projectPath?: string) => string;
  /** @deprecated Projects are now shown in sidebar - this method does nothing */
  createProjectsTab: () => string | null;
  createAgentsTab: () => string | null;
  createUsageTab: () => string | null;
  createMCPTab: () => string | null;
  createSettingsTab: () => string | null;
  createClaudeMdTab: () => string | null;
  createClaudeFileTab: (fileId: string, fileName: string) => string;
  createCreateAgentTab: () => string;
  createImportAgentTab: () => string;
  createDiffTab: (filePath: string, projectPath: string) => string | null;
  createFileTab: (filePath: string, projectPath: string) => string | null;
  createWebViewerTab: (url: string, projectPath: string) => string | null;
  closeTab: (id: string, force?: boolean) => Promise<boolean>;
  closeCurrentTab: () => Promise<boolean>;
  switchToTab: (id: string) => void;
  switchToNextTab: () => void;
  switchToPreviousTab: () => void;
  switchToTabByIndex: (index: number) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabStatus: (id: string, status: Tab['status']) => void;
  markTabAsChanged: (id: string, hasChanges: boolean) => void;
  findTabBySessionId: (sessionId: string) => Tab | undefined;
  findTabByAgentRunId: (agentRunId: string) => Tab | undefined;
  findTabByType: (type: Tab['type']) => Tab | undefined;
  findTabByProjectPath: (projectPath: string) => Tab | undefined;
  getTabById: (id: string) => Tab | undefined;
  canAddTab: () => boolean;
}

export const useTabState = (): UseTabStateReturn => {
  const {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    getTabById,
    getTabsByType
  } = useTabContext();

  const activeTab = useMemo(() =>
    activeTabId ? getTabById(activeTabId) : undefined,
    [activeTabId, getTabById]
  );

  const tabCount = tabs.length;
  const chatTabCount = useMemo(() => getTabsByType('chat').length, [getTabsByType]);
  const agentTabCount = useMemo(() => getTabsByType('agent').length, [getTabsByType]);

  /**
   * Helper function to create or reuse a global utility tab
   * Global utility tabs share the same tab slot - creating a new one replaces the existing one
   * Workspace-specific tabs (chat, diff, agent, agent-execution) do NOT use this function
   */
  const createOrReuseUtilityTab = useCallback((
    type: Tab['type'],
    title: string,
    icon: string,
    additionalProps?: Partial<Tab>
  ): string => {
    // Find existing global utility tab (only global tabs, not workspace-specific)
    const existingUtilityTab = tabs.find(tab =>
      tab.type !== 'chat' &&
      tab.type !== 'agent' &&
      tab.type !== 'agent-execution' &&
      tab.type !== 'diff' && // Diff tabs are workspace-specific, not global
      tab.type !== 'file' && // File tabs are workspace-specific, not global
      !tab.workspaceId // Must not have a workspaceId to be considered a global utility tab
    );

    // If there's an existing utility tab, replace its content
    if (existingUtilityTab) {
      // Clear all type-specific properties to ensure clean slate
      updateTab(existingUtilityTab.id, {
        type,
        title,
        icon,
        status: 'idle',
        hasUnsavedChanges: false,
        // Clear all type-specific properties (including workspaceId for global tabs)
        workspaceId: undefined,
        sessionId: undefined,
        sessionData: undefined,
        agentRunId: undefined,
        agentData: undefined,
        claudeFileId: undefined,
        diffFilePath: undefined,
        filePath: undefined,
        initialProjectPath: undefined,
        projectPath: undefined,
        providerId: undefined,
        providerSessions: undefined,
        // Apply new properties (may include workspaceId for workspace-specific tabs like diff)
        ...additionalProps
      });
      setActiveTab(existingUtilityTab.id);
      return existingUtilityTab.id;
    }

    // No utility tab exists, create a new one
    return addTab({
      type,
      title,
      status: 'idle',
      hasUnsavedChanges: false,
      icon,
      ...additionalProps
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  const createChatTab = useCallback((projectId?: string, title?: string, projectPath?: string, providerId?: string, sessionData?: any): string => {
    const tabTitle = title || `Chat ${chatTabCount + 1}`;
    return addTab({
      type: 'chat',
      title: tabTitle,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      sessionId: projectId,
      initialProjectPath: projectPath,
      providerId: providerId, // Include providerId at creation time to avoid key change
      sessionData: sessionData, // Include sessionData at creation time
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'message-square'
    });
  }, [addTab, chatTabCount]);

  const createAgentTab = useCallback((agentRunId: string, agentName: string, projectPath?: string): string => {
    // Check if tab already exists
    const existingTab = tabs.find(tab => tab.agentRunId === agentRunId);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'agent',
      title: agentName,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      agentRunId,
      status: 'running',
      hasUnsavedChanges: false,
      icon: 'bot'
    });
  }, [addTab, tabs, setActiveTab]);

  /**
   * @deprecated Projects are now shown in the left sidebar permanently
   * This method is kept for backward compatibility but does nothing
   */
  const createProjectsTab = useCallback((): string | null => {
    console.warn('createProjectsTab is deprecated - projects are now shown in sidebar');
    return null;
  }, []);

  const createAgentsTab = useCallback((): string | null => {
    return createOrReuseUtilityTab('agents', 'Agents', 'bot');
  }, [createOrReuseUtilityTab]);

  const createUsageTab = useCallback((): string | null => {
    return createOrReuseUtilityTab('usage', 'Usage', 'bar-chart');
  }, [createOrReuseUtilityTab]);

  const createMCPTab = useCallback((): string | null => {
    return createOrReuseUtilityTab('mcp', 'MCP Servers', 'server');
  }, [createOrReuseUtilityTab]);

  const createSettingsTab = useCallback((): string | null => {
    return createOrReuseUtilityTab('settings', 'Settings', 'settings');
  }, [createOrReuseUtilityTab]);

  const createClaudeMdTab = useCallback((): string | null => {
    return createOrReuseUtilityTab('claude-md', 'Memory', 'file-text');
  }, [createOrReuseUtilityTab]);

  const createClaudeFileTab = useCallback((fileId: string, fileName: string): string => {
    return createOrReuseUtilityTab('claude-file', fileName, 'file-text', {
      claudeFileId: fileId
    });
  }, [createOrReuseUtilityTab]);

  const createAgentExecutionTab = useCallback((agent: any, _tabId: string, projectPath?: string): string => {
    return addTab({
      type: 'agent-execution',
      title: `Run: ${agent.name}`,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      agentData: agent,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'bot'
    });
  }, [addTab]);

  const createCreateAgentTab = useCallback((): string => {
    return createOrReuseUtilityTab('create-agent', 'Create Agent', 'plus');
  }, [createOrReuseUtilityTab]);

  const createImportAgentTab = useCallback((): string => {
    return createOrReuseUtilityTab('import-agent', 'Import Agent', 'import');
  }, [createOrReuseUtilityTab]);

  const createDiffTab = useCallback((filePath: string, projectPath: string): string | null => {
    // Extract filename from path for tab title
    const fileName = filePath.split('/').pop() || filePath;

    // Check if file or diff tab for this workspace already exists
    // File and Diff tabs share the same slot - they are mutually exclusive
    const existingTab = tabs.find(tab =>
      (tab.type === 'diff' || tab.type === 'file') &&
      tab.workspaceId === projectPath
    );

    if (existingTab) {
      // Update/convert existing tab to diff tab
      updateTab(existingTab.id, {
        type: 'diff',
        title: `Diff: ${fileName}`,
        icon: 'file-diff',
        diffFilePath: filePath,
        projectPath: projectPath,
        // Clear file-specific properties
        filePath: undefined,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    // No file/diff tab for this workspace, create a new diff tab
    return addTab({
      type: 'diff',
      title: `Diff: ${fileName}`,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      diffFilePath: filePath,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file-diff'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  const createFileTab = useCallback((filePath: string, projectPath: string): string | null => {
    // Extract filename from path for tab title
    const fileName = filePath.split('/').pop() || filePath;

    // Check if file or diff tab for this workspace already exists
    // File and Diff tabs share the same slot - they are mutually exclusive
    const existingTab = tabs.find(tab =>
      (tab.type === 'file' || tab.type === 'diff') &&
      tab.workspaceId === projectPath
    );

    if (existingTab) {
      // Update/convert existing tab to file tab
      updateTab(existingTab.id, {
        type: 'file',
        title: fileName,
        icon: 'file',
        filePath: filePath,
        projectPath: projectPath,
        // Clear diff-specific properties
        diffFilePath: undefined,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    // No file/diff tab for this workspace, create a new file tab
    return addTab({
      type: 'file',
      title: fileName,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      filePath: filePath,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  const createWebViewerTab = useCallback((url: string, projectPath: string): string | null => {
    // Extract domain from URL for tab title
    let displayName = 'Web';
    try {
      const urlObj = new URL(url);
      displayName = urlObj.hostname || displayName;
    } catch {
      // Invalid URL, use default title
      displayName = 'Web';
    }

    // Check if webview tab for this workspace already exists
    // WebViewer tabs are workspace-specific and follow single-instance pattern
    // Each workspace has at most one webview tab (similar to file/diff tabs)
    const existingTab = tabs.find(tab =>
      tab.type === 'webview' &&
      tab.workspaceId === projectPath
    );

    if (existingTab) {
      // Update existing webview tab with new URL
      updateTab(existingTab.id, {
        title: displayName,
        webviewUrl: url,
        status: 'idle',
        hasUnsavedChanges: false
      });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    // No webview tab for this workspace, create a new one
    return addTab({
      type: 'webview',
      title: displayName,
      workspaceId: projectPath, // Use projectPath as workspaceId for workspace isolation
      webviewUrl: url,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'globe'
    });
  }, [tabs, addTab, updateTab, setActiveTab]);

  const closeTab = useCallback(async (id: string, force: boolean = false): Promise<boolean> => {
    const tab = getTabById(id);
    if (!tab) return true;

    // Check for unsaved changes
    if (!force && tab.hasUnsavedChanges) {
      // In a real implementation, you'd show a confirmation dialog here
      const confirmed = window.confirm(`Tab "${tab.title}" has unsaved changes. Close anyway?`);
      if (!confirmed) return false;
    }

    removeTab(id);
    return true;
  }, [getTabById, removeTab]);

  const closeCurrentTab = useCallback(async (): Promise<boolean> => {
    if (!activeTabId) return true;
    return closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const switchToNextTab = useCallback(() => {
    if (tabs.length === 0) return;
    
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    setActiveTab(tabs[nextIndex].id);
  }, [tabs, activeTabId, setActiveTab]);

  const switchToPreviousTab = useCallback(() => {
    if (tabs.length === 0) return;
    
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    const previousIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
    setActiveTab(tabs[previousIndex].id);
  }, [tabs, activeTabId, setActiveTab]);

  const switchToTabByIndex = useCallback((index: number) => {
    if (index >= 0 && index < tabs.length) {
      setActiveTab(tabs[index].id);
    }
  }, [tabs, setActiveTab]);

  const updateTabTitle = useCallback((id: string, title: string) => {
    updateTab(id, { title });
  }, [updateTab]);

  const updateTabStatus = useCallback((id: string, status: Tab['status']) => {
    updateTab(id, { status });
  }, [updateTab]);

  const markTabAsChanged = useCallback((id: string, hasChanges: boolean) => {
    updateTab(id, { hasUnsavedChanges: hasChanges });
  }, [updateTab]);

  const findTabBySessionId = useCallback((sessionId: string): Tab | undefined => {
    return tabs.find(tab => tab.type === 'chat' && tab.sessionId === sessionId);
  }, [tabs]);

  const findTabByAgentRunId = useCallback((agentRunId: string): Tab | undefined => {
    return tabs.find(tab => tab.type === 'agent' && tab.agentRunId === agentRunId);
  }, [tabs]);

  const findTabByType = useCallback((type: Tab['type']): Tab | undefined => {
    return tabs.find(tab => tab.type === type);
  }, [tabs]);

  const findTabByProjectPath = useCallback((projectPath: string): Tab | undefined => {
    return tabs.find(tab => {
      // Check for chat tabs with matching project path
      if (tab.type === 'chat') {
        // Check initialProjectPath
        if (tab.initialProjectPath === projectPath) {
          return true;
        }
        // Check sessionData.project_path
        if (tab.sessionData && tab.sessionData.project_path === projectPath) {
          return true;
        }
      }
      // Check for agent-execution tabs with matching project path
      if (tab.type === 'agent-execution' && tab.projectPath === projectPath) {
        return true;
      }
      return false;
    });
  }, [tabs]);

  const canAddTab = useCallback((): boolean => {
    return tabs.length < 50; // MAX_TABS from context
  }, [tabs.length]);

  return {
    // State
    tabs,
    activeTab,
    activeTabId,
    tabCount,
    chatTabCount,
    agentTabCount,

    // Operations
    createChatTab,
    createAgentTab,
    createAgentExecutionTab,
    createProjectsTab,
    createAgentsTab,
    createUsageTab,
    createMCPTab,
    createSettingsTab,
    createClaudeMdTab,
    createClaudeFileTab,
    createCreateAgentTab,
    createImportAgentTab,
    createDiffTab,
    createFileTab,
    createWebViewerTab,
    closeTab,
    closeCurrentTab,
    switchToTab: setActiveTab,
    switchToNextTab,
    switchToPreviousTab,
    switchToTabByIndex,
    updateTab,
    updateTabTitle,
    updateTabStatus,
    markTabAsChanged,
    findTabBySessionId,
    findTabByAgentRunId,
    findTabByType,
    findTabByProjectPath,
    getTabById,
    canAddTab
  };
};