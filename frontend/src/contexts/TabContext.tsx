import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { TabPersistenceService } from '@/services/tabPersistence';

export interface Tab {
  id: string;
  type: 'chat' | 'agent' | 'agents' | 'usage' | 'mcp' | 'settings' | 'claude-md' | 'claude-file' | 'agent-execution' | 'create-agent' | 'import-agent' | 'diff' | 'file' | 'webview';
  title: string;
  workspaceId?: string; // Project/workspace identifier - undefined for global utility tabs
  sessionId?: string;  // for chat tabs
  sessionData?: any; // for chat tabs - stores full session object
  agentRunId?: string; // for agent tabs
  agentData?: any; // for agent-execution tabs
  claudeFileId?: string; // for claude-file tabs
  diffFilePath?: string; // for diff tabs
  filePath?: string; // for file tabs (read-only file viewer)
  webviewUrl?: string; // for webview tabs - the URL to display
  initialProjectPath?: string; // for chat tabs
  projectPath?: string; // for agent-execution tabs, diff tabs, file tabs, and webview tabs
  providerId?: string; // for chat tabs - which AI provider to use (claude, codex, etc.)
  providerSessions?: Record<string, { sessionId: string; sessionData: any }>; // Store session per provider
  status: 'active' | 'idle' | 'running' | 'complete' | 'error';
  hasUnsavedChanges: boolean;
  order: number;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TabContextType {
  tabs: Tab[];
  activeTabId: string | null;
  currentWorkspaceId: string | null; // Current active workspace/project identifier
  lastActiveChatTabId: string | null; // 最后一个活动的 Chat Tab ID，用于侧边栏保持选中状态
  addTab: (tab: Omit<Tab, 'id' | 'order' | 'createdAt' | 'updatedAt'>) => string;
  removeTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  setActiveTab: (id: string) => void;
  setCurrentWorkspace: (workspaceId: string | null) => void; // Set the current workspace
  reorderTabs: (startIndex: number, endIndex: number) => void;
  getTabById: (id: string) => Tab | undefined;
  closeAllTabs: () => void;
  getTabsByType: (type: 'chat' | 'agent') => Tab[];
  getTabsByWorkspace: (workspaceId: string | null) => Tab[]; // Get tabs for specific workspace
  getActiveChatTab: () => Tab | undefined; // 获取当前活动的 Chat Tab
}

const TabContext = createContext<TabContextType | undefined>(undefined);

// const STORAGE_KEY = 'ropcode_tabs'; // No longer needed - persistence disabled
const MAX_TABS = 50;

/**
 * Helper function to determine if a tab type should be workspace-specific
 *
 * Workspace-specific tabs (require workspaceId):
 * - chat: Project chat sessions
 * - diff: Project file diffs
 * - file: Project file viewer (read-only)
 * - webview: Web viewer (workspace-specific, one per workspace)
 * - agent-execution: Agent runs in specific projects
 * - agent: Agent run outputs (project-specific)
 *
 * Global tabs (no workspaceId):
 * - agents: Agent management
 * - usage: Usage dashboard
 * - mcp: MCP servers
 * - settings: Settings
 * - claude-md: Memory editor
 * - claude-file: Claude file editor
 * - create-agent: Create agent
 * - import-agent: Import agent
 */
export function isWorkspaceSpecificTab(type: Tab['type']): boolean {
  return ['chat', 'diff', 'file', 'webview', 'agent-execution', 'agent'].includes(type);
}

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [lastActiveChatTabId, setLastActiveChatTabId] = useState<string | null>(null);
  const isInitialized = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // 修改：禁用启动时自动恢复 tabs，让软件打开时不自动打开任何项目
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    // Migrate from old format if needed (still needed for cleanup)
    TabPersistenceService.migrateFromOldFormat();

    // 清空保存的 tabs，确保软件启动时不自动打开任何项目
    console.log('[TabContext] 初始化：清空保存的 tabs，从空白状态开始...');
    TabPersistenceService.clearTabs();
    setTabs([]);
    setActiveTabId(null);
    setLastActiveChatTabId(null);
  }, []);

  // === 核心：监听 activeTabId 变化，更新 lastActiveChatTabId 和 currentWorkspaceId ===
  useEffect(() => {
    if (!activeTabId) return;

    const activeTab = tabs.find(t => t.id === activeTabId);

    // 如果激活的是 Chat Tab，更新 lastActiveChatTabId
    if (activeTab?.type === 'chat') {
      setLastActiveChatTabId(activeTabId);
    }
    // 如果激活的是其他类型 Tab，lastActiveChatTabId 保持不变

    // 更新 currentWorkspaceId：如果 Tab 有 workspaceId，切换到该工作区
    if (activeTab?.workspaceId) {
      setCurrentWorkspaceId(activeTab.workspaceId);
    }
  }, [activeTabId, tabs]);

  // Save tabs to localStorage with debounce (for backup purposes, but not restored on startup)
  useEffect(() => {
    // Don't save if not initialized
    if (!isInitialized.current) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce saving to avoid excessive writes
    saveTimeoutRef.current = setTimeout(() => {
      TabPersistenceService.saveTabs(tabs, activeTabId);
    }, 500); // Wait 500ms after last change before saving

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tabs, activeTabId]);

  // Save tabs immediately when window is about to close (for backup purposes, but not restored on startup)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isInitialized.current && tabs.length > 0) {
        TabPersistenceService.saveTabs(tabs, activeTabId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Save one final time when component unmounts
      if (isInitialized.current && tabs.length > 0) {
        TabPersistenceService.saveTabs(tabs, activeTabId);
      }
    };
  }, [tabs, activeTabId]);

  const generateTabId = () => {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const addTab = useCallback((tabData: Omit<Tab, 'id' | 'order' | 'createdAt' | 'updatedAt'>): string => {
    let newTabId = '';

    setTabs(prevTabs => {
      if (prevTabs.length >= MAX_TABS) {
        throw new Error(`Maximum number of tabs (${MAX_TABS}) reached`);
      }

      const newTab: Tab = {
        ...tabData,
        id: generateTabId(),
        order: prevTabs.length,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      newTabId = newTab.id;
      return [...prevTabs, newTab];
    });

    setActiveTabId(newTabId);
    return newTabId;
  }, []);

  const removeTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      const tabToRemove = prevTabs.find(t => t.id === id);
      if (!tabToRemove) return prevTabs;

      const filteredTabs = prevTabs.filter(tab => tab.id !== id);

      // Reorder remaining tabs
      const reorderedTabs = filteredTabs.map((tab, index) => ({
        ...tab,
        order: index
      }));

      return reorderedTabs;
    });

    // Update active tab if necessary (using callback to get latest state)
    setActiveTabId(currentActiveId => {
      if (currentActiveId !== id) return currentActiveId;

      // Need to check reordered tabs - use a separate effect or closure
      setTabs(currentTabs => {
        if (currentTabs.length === 0) {
          setActiveTabId(null);
          return currentTabs;
        }

        // Only select tabs visible in current workspace
        const visibleTabs = currentTabs.filter(tab => {
          if (!tab.workspaceId) return true;
          return tab.workspaceId === currentWorkspaceId;
        });

        if (visibleTabs.length > 0) {
          setActiveTabId(visibleTabs[0].id);
        } else {
          setActiveTabId(null);
        }

        return currentTabs;
      });

      return currentActiveId;
    });

    // Handle lastActiveChatTabId logic
    setLastActiveChatTabId(currentLastId => {
      if (id !== currentLastId) return currentLastId;

      // Find remaining chat tabs
      let nextChatTabId: string | null = null;
      setTabs(currentTabs => {
        const remainingChatTabs = currentTabs.filter(t => t.type === 'chat');
        if (remainingChatTabs.length > 0) {
          nextChatTabId = remainingChatTabs.sort((a, b) => a.order - b.order)[0].id;
        }
        return currentTabs;
      });

      return nextChatTabId;
    });
  }, [currentWorkspaceId]);

  const updateTab = useCallback((id: string, updates: Partial<Tab>) => {
    setTabs(prevTabs => 
      prevTabs.map(tab => 
        tab.id === id 
          ? { ...tab, ...updates, updatedAt: new Date() }
          : tab
      )
    );
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      if (prevTabs.find(tab => tab.id === id)) {
        setActiveTabId(id);
      }
      return prevTabs;
    });
  }, []);

  const reorderTabs = useCallback((startIndex: number, endIndex: number) => {
    setTabs(prevTabs => {
      const newTabs = [...prevTabs];
      const [removed] = newTabs.splice(startIndex, 1);
      newTabs.splice(endIndex, 0, removed);
      
      // Update order property
      return newTabs.map((tab, index) => ({
        ...tab,
        order: index
      }));
    });
  }, []);

  const getTabById = useCallback((id: string): Tab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    TabPersistenceService.clearTabs();
  }, []);

  const getTabsByType = useCallback((type: 'chat' | 'agent'): Tab[] => {
    return tabs.filter(tab => tab.type === type);
  }, [tabs]);

  // === 核心：获取当前活动的 Chat Tab ===
  const getActiveChatTab = useCallback((): Tab | undefined => {
    return tabs.find(t => t.id === lastActiveChatTabId);
  }, [tabs, lastActiveChatTabId]);

  // === 新增：根据工作区获取 Tabs ===
  const getTabsByWorkspace = useCallback((workspaceId: string | null): Tab[] => {
    return tabs.filter(tab => {
      // Global utility tabs (no workspaceId) are visible in all workspaces
      if (!tab.workspaceId) {
        return true;
      }
      // Workspace-specific tabs are only visible in their workspace
      return tab.workspaceId === workspaceId;
    });
  }, [tabs]);

  // === 新增：设置当前工作区 ===
  const setCurrentWorkspace = useCallback((workspaceId: string | null) => {
    setCurrentWorkspaceId(workspaceId);

    // 当切换工作区时，尝试激活该工作区的第一个 Tab
    const workspaceTabs = tabs.filter(tab => tab.workspaceId === workspaceId);
    if (workspaceTabs.length > 0) {
      setActiveTabId(workspaceTabs[0].id);
    } else {
      // 如果该工作区没有 Tab，激活第一个全局工具 Tab
      const globalTabs = tabs.filter(tab => !tab.workspaceId);
      if (globalTabs.length > 0) {
        setActiveTabId(globalTabs[0].id);
      }
    }
  }, [tabs]);

  const value: TabContextType = {
    tabs,
    activeTabId,
    currentWorkspaceId,
    lastActiveChatTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    setCurrentWorkspace,
    reorderTabs,
    getTabById,
    closeAllTabs,
    getTabsByType,
    getTabsByWorkspace,
    getActiveChatTab
  };

  return (
    <TabContext.Provider value={value}>
      {children}
    </TabContext.Provider>
  );
};

export const useTabContext = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within a TabProvider');
  }
  return context;
};
