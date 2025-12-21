import React, { createContext, useState, useContext, useCallback } from 'react';

// System Tab 类型（全局工具）
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
  getTabById: (id: string) => SystemTab | undefined;
  getActiveTab: () => SystemTab | undefined;
}

const SystemTabContext = createContext<SystemTabContextType | undefined>(undefined);

// Tab 配置映射
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
  const [tabs, setTabs] = useState<SystemTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const generateTabId = () => {
    return `systab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // 激活或创建系统 Tab（全局工具 Tab 采用单例模式）
  const activateTab = useCallback((type: SystemTabType): string => {
    // 查找是否已存在该类型的 Tab
    const existingTab = tabs.find(tab => tab.type === type);

    if (existingTab) {
      setActiveTabId(existingTab.id);
      return existingTab.id;
    }

    // 创建新 Tab
    const config = TAB_CONFIG[type];
    const newTab: SystemTab = {
      id: generateTabId(),
      type,
      title: config.title,
      icon: config.icon,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, [tabs]);

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
