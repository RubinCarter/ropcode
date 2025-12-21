import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

// 容器类型
export type ContainerType = 'system' | 'workspace';

// 容器状态接口
export interface ContainerState {
  // 激活类型：系统工具 or 项目 workspace
  activeType: ContainerType;
  // 当前激活的 workspace ID（仅 activeType === 'workspace' 时有效）
  activeWorkspaceId: string | null;
  // 已打开的 workspace 列表（projectPath 作为 ID）
  openWorkspaces: string[];
  // 上一次激活的 workspace ID（用于从 system 返回）
  lastActiveWorkspaceId: string | null;
}

interface ContainerContextType extends ContainerState {
  // 切换到系统容器
  switchToSystem: () => void;
  // 切换到指定 workspace
  switchToWorkspace: (workspaceId: string) => void;
  // 关闭 workspace
  closeWorkspace: (workspaceId: string) => void;
  // 检查 workspace 是否已打开
  isWorkspaceOpen: (workspaceId: string) => boolean;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

export const ContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeType, setActiveType] = useState<ContainerType>('system');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [openWorkspaces, setOpenWorkspaces] = useState<string[]>([]);
  const [lastActiveWorkspaceId, setLastActiveWorkspaceId] = useState<string | null>(null);

  // 切换到系统容器
  const switchToSystem = useCallback(() => {
    // 保存当前 workspace 以便返回
    if (activeType === 'workspace' && activeWorkspaceId) {
      setLastActiveWorkspaceId(activeWorkspaceId);
    }
    setActiveType('system');
  }, [activeType, activeWorkspaceId]);

  // 切换到 workspace
  const switchToWorkspace = useCallback((workspaceId: string) => {
    // 如果 workspace 未打开，先添加到 openWorkspaces
    setOpenWorkspaces(prev => {
      if (!prev.includes(workspaceId)) {
        return [...prev, workspaceId];
      }
      return prev;
    });

    setActiveType('workspace');
    setActiveWorkspaceId(workspaceId);
  }, []);

  // 关闭 workspace
  const closeWorkspace = useCallback((workspaceId: string) => {
    setOpenWorkspaces(prev => prev.filter(id => id !== workspaceId));

    // 如果关闭的是当前激活的 workspace，切换到其他
    if (activeWorkspaceId === workspaceId) {
      const remaining = openWorkspaces.filter(id => id !== workspaceId);
      if (remaining.length > 0) {
        // 切换到最后一个打开的 workspace
        setActiveWorkspaceId(remaining[remaining.length - 1]);
      } else {
        // 没有其他 workspace，切换到系统容器
        setActiveType('system');
        setActiveWorkspaceId(null);
      }
    }

    // 清理 lastActiveWorkspaceId
    if (lastActiveWorkspaceId === workspaceId) {
      setLastActiveWorkspaceId(null);
    }
  }, [activeWorkspaceId, openWorkspaces, lastActiveWorkspaceId]);

  // 检查 workspace 是否已打开
  const isWorkspaceOpen = useCallback((workspaceId: string) => {
    return openWorkspaces.includes(workspaceId);
  }, [openWorkspaces]);

  const value: ContainerContextType = {
    activeType,
    activeWorkspaceId,
    openWorkspaces,
    lastActiveWorkspaceId,
    switchToSystem,
    switchToWorkspace,
    closeWorkspace,
    isWorkspaceOpen,
  };

  return (
    <ContainerContext.Provider value={value}>
      {children}
    </ContainerContext.Provider>
  );
};

export const useContainerContext = () => {
  const context = useContext(ContainerContext);
  if (!context) {
    throw new Error('useContainerContext must be used within a ContainerProvider');
  }
  return context;
};
