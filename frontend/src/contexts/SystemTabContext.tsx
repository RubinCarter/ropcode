import React, { createContext, useState, useContext, useCallback } from 'react';

// System Tab types (global tools)
export type SystemTabType = 'agents' | 'usage' | 'mcp' | 'settings' | 'claude-md' | 'create-agent' | 'import-agent';

export interface SystemTab {
  id: string;
  type: SystemTabType;
  title: string;
  icon?: string;
  claudeFileId?: string; // for claude-md if needed
  status: 'active' | 'idle';
  createdAt: Date;
  updatedAt: Date;
}

interface SystemTabContextType {
  tabs: SystemTab[];
  activeTabId: string | null;
  activateTab: (type: SystemTabType) => string;
  closeTab: () => void;
  getTabById: (id: string) => SystemTab | undefined;
  getActiveTab: () => SystemTab | undefined;
}

const SystemTabContext = createContext<SystemTabContextType | undefined>(undefined);

// Tab config mapping
const TAB_CONFIG: Record<SystemTabType, { title: string; icon: string }> = {
  'agents': { title: 'Agents', icon: 'bot' },
  'usage': { title: 'Usage', icon: 'bar-chart' },
  'mcp': { title: 'MCP Servers', icon: 'server' },
  'settings': { title: 'Settings', icon: 'settings' },
  'claude-md': { title: 'Memory', icon: 'file-text' },
  'create-agent': { title: 'Create Agent', icon: 'plus' },
  'import-agent': { title: 'Import Agent', icon: 'import' },
};

export const SystemTabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Only one shared Tab slot
  const [currentTab, setCurrentTab] = useState<SystemTab | null>(null);

  const generateTabId = () => {
    return `systab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Activate system Tab (all tool Tabs share one slot, content replaced on switch)
  const activateTab = useCallback((type: SystemTabType): string => {
    const config = TAB_CONFIG[type];

    // If Tab already exists, update its content
    if (currentTab) {
      const updatedTab: SystemTab = {
        ...currentTab,
        type,
        title: config.title,
        icon: config.icon,
        updatedAt: new Date(),
      };
      setCurrentTab(updatedTab);
      return updatedTab.id;
    }

    // Create Tab for the first time
    const newTab: SystemTab = {
      id: generateTabId(),
      type,
      title: config.title,
      icon: config.icon,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setCurrentTab(newTab);
    return newTab.id;
  }, [currentTab]);

  // Close current Tab
  const closeTab = useCallback(() => {
    setCurrentTab(null);
  }, []);

  // Compatibility: tabs array has one element or is empty
  const tabs = currentTab ? [currentTab] : [];
  const activeTabId = currentTab?.id || null;

  const getTabById = useCallback((id: string): SystemTab | undefined => {
    return tabs.find(tab => tab.id === id);
  }, [tabs]);

  const getActiveTab = useCallback((): SystemTab | undefined => {
    if (!activeTabId) return undefined;
    return tabs.find(tab => tab.id === activeTabId);
  }, [tabs, activeTabId]);

  const value: SystemTabContextType = {
    tabs,
    activeTabId,
    activateTab,
    closeTab,
    getTabById,
    getActiveTab,
  };

  return (
    <SystemTabContext.Provider value={value}>
      {children}
    </SystemTabContext.Provider>
  );
};

export const useSystemTabContext = () => {
  const context = useContext(SystemTabContext);
  if (!context) {
    throw new Error('useSystemTabContext must be used within a SystemTabProvider');
  }
  return context;
};
