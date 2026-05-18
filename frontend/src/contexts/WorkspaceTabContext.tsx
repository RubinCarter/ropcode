import React, { createContext, useState, useContext, useCallback } from 'react';

// Workspace 内的 Tab 类型（只包含 workspace 专属的）
export type WorkspaceTabType = 'chat' | 'diff' | 'file' | 'webview' | 'agent-execution' | 'agent' | 'claude-file';

export interface WorkspaceTab {
  id: string;
  type: WorkspaceTabType;
  title: string;
  sessionId?: string;
  sessionData?: any;
  agentRunId?: string;
  agentData?: any;
  claudeFileId?: string;
  diffFilePath?: string;
  filePath?: string;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  webviewUrl?: string;
  url?: string;  // for webview tabs
  projectPath?: string;
  providerId?: string;
  providerSessions?: Record<string, { sessionId: string; sessionData: any }>;
  skipSessionRestore?: boolean;
  status: 'active' | 'idle' | 'running' | 'closed' | 'complete' | 'error';
  hasUnsavedChanges: boolean;
  icon?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkspaceTabContextType {
  workspaceId: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>) => string;
  removeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string, orderedTabIds: string[]) => void;
  updateTab: (id: string, updates: Partial<WorkspaceTab>) => void;
  setActiveTab: (id: string) => void;
  getTabById: (id: string) => WorkspaceTab | undefined;
  findTabByType: (type: WorkspaceTabType) => WorkspaceTab | undefined;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextType | undefined>(undefined);

interface WorkspaceTabProviderProps {
  workspaceId: string;
  children: React.ReactNode;
}

export const WorkspaceTabProvider: React.FC<WorkspaceTabProviderProps> = ({ workspaceId, children }) => {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const generateTabId = () => {
    return `wstab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const findEquivalentTab = (
    existingTabs: WorkspaceTab[],
    tabData: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>
  ): WorkspaceTab | undefined => {
    if (tabData.type === 'chat') {
      if (tabData.sessionId && tabData.providerId) {
        return existingTabs.find(tab =>
          tab.type === 'chat' &&
          tab.sessionId === tabData.sessionId &&
          tab.providerId === tabData.providerId
        );
      }

      if (tabData.skipSessionRestore && tabData.projectPath) {
        return existingTabs.find(tab =>
          tab.type === 'chat' &&
          tab.projectPath === tabData.projectPath &&
          tab.skipSessionRestore === true &&
          !tab.sessionId &&
          !tab.sessionData
        );
      }
    }

    return undefined;
  };

  const addTab = useCallback((tabData: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const provisionalTabId = generateTabId();
    const newTab: WorkspaceTab = {
      ...tabData,
      id: provisionalTabId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let selectedTabId = provisionalTabId;
    setTabs(prev => {
      const existingTab = findEquivalentTab(prev, tabData);
      if (existingTab) {
        selectedTabId = existingTab.id;
        setActiveTabId(existingTab.id);
        return prev;
      }

      setActiveTabId(provisionalTabId);
      return [...prev, newTab];
    });
    return selectedTabId;
  }, []);

  const removeTab = useCallback((id: string) => {
    setTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== id);

      // 如果删除的是当前激活的 tab，切换到其他
      if (activeTabId === id && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }

      return filtered;
    });
  }, [activeTabId]);

  const closeOtherTabs = useCallback((id: string) => {
    setTabs(prev => {
      const targetTab = prev.find(tab => tab.id === id);
      if (!targetTab) return prev;
      setActiveTabId(id);
      return [targetTab];
    });
  }, []);

  const closeTabsToRight = useCallback((id: string, orderedTabIds: string[]) => {
    setTabs(prev => {
      const targetIndex = orderedTabIds.indexOf(id);
      if (targetIndex < 0) return prev;

      const idsToClose = new Set(orderedTabIds.slice(targetIndex + 1));
      if (idsToClose.size === 0) return prev;

      const filtered = prev.filter(tab => !idsToClose.has(tab.id));
      if (activeTabId && idsToClose.has(activeTabId)) {
        setActiveTabId(id);
      }
      return filtered;
    });
  }, [activeTabId]);

  const updateTab = useCallback((id: string, updates: Partial<WorkspaceTab>) => {
    setTabs(prev =>
      prev.map(tab =>
        tab.id === id
          ? { ...tab, ...updates, updatedAt: new Date() }
          : tab
      )
    );
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.find(tab => tab.id === id)) {
        setActiveTabId(id);
      }
      return prev;
    });
  }, []);

  const getTabById = useCallback((id: string): WorkspaceTab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const findTabByType = useCallback((type: WorkspaceTabType): WorkspaceTab | undefined => {
    return tabs.find(tab => tab.type === type);
  }, [tabs]);

  const value: WorkspaceTabContextType = {
    workspaceId,
    tabs,
    activeTabId,
    addTab,
    removeTab,
    closeOtherTabs,
    closeTabsToRight,
    updateTab,
    setActiveTab,
    getTabById,
    findTabByType,
  };

  return (
    <WorkspaceTabContext.Provider value={value}>
      {children}
    </WorkspaceTabContext.Provider>
  );
};

export const useWorkspaceTabContext = () => {
  const context = useContext(WorkspaceTabContext);
  if (!context) {
    throw new Error('useWorkspaceTabContext must be used within a WorkspaceTabProvider');
  }
  return context;
};
