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
  closeTab: () => void;
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
  // 只有一个共用的 Tab slot
  const [currentTab, setCurrentTab] = useState<SystemTab | null>(null);

  const generateTabId = () => {
    return `systab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // 激活系统 Tab（所有工具 Tab 共用同一个 slot，切换时替换内容）
  const activateTab = useCallback((type: SystemTabType): string => {
    const config = TAB_CONFIG[type];

    // 如果当前已有 Tab，更新其内容
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

    // 首次创建 Tab
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

  // 关闭当前 Tab
  const closeTab = useCallback(() => {
    setCurrentTab(null);
  }, []);

  // 兼容性：tabs 数组只有一个元素或为空
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
