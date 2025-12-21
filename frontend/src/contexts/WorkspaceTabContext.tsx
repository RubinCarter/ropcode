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
  webviewUrl?: string;
  projectPath?: string;
  providerId?: string;
  providerSessions?: Record<string, { sessionId: string; sessionData: any }>;
  status: 'active' | 'idle' | 'running' | 'complete' | 'error';
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

  const addTab = useCallback((tabData: Omit<WorkspaceTab, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const newTab: WorkspaceTab = {
      ...tabData,
      id: generateTabId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
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
