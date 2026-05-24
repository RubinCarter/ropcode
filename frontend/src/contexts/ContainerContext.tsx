import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';

// Container type
export type ContainerType = 'system' | 'workspace';

// Container state interface
export interface ContainerState {
  // Active type: system tools or project workspace
  activeType: ContainerType;
  // Active workspace ID (only valid when activeType === 'workspace')
  activeWorkspaceId: string | null;
  // List of open workspaces (projectPath as ID)
  openWorkspaces: string[];
  // Last active workspace ID (for returning from system)
  lastActiveWorkspaceId: string | null;
}

interface ContainerContextType extends ContainerState {
  // Switch to system container
  switchToSystem: () => void;
  // Switch to specified workspace
  switchToWorkspace: (workspaceId: string) => void;
  // Close workspace
  closeWorkspace: (workspaceId: string) => void;
  // Check if workspace is already open
  isWorkspaceOpen: (workspaceId: string) => boolean;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

export const ContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeType, setActiveType] = useState<ContainerType>('system');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [openWorkspaces, setOpenWorkspaces] = useState<string[]>([]);
  const [lastActiveWorkspaceId, setLastActiveWorkspaceId] = useState<string | null>(null);

  // Switch to system container
  const switchToSystem = useCallback(() => {
    // Save current workspace for returning later
    if (activeType === 'workspace' && activeWorkspaceId) {
      setLastActiveWorkspaceId(activeWorkspaceId);
    }
    setActiveType('system');
  }, [activeType, activeWorkspaceId]);

  // Switch to workspace
  const switchToWorkspace = useCallback((workspaceId: string) => {
    // If workspace not open, add to openWorkspaces first
    setOpenWorkspaces(prev => {
      if (!prev.includes(workspaceId)) {
        return [...prev, workspaceId];
      }
      return prev;
    });

    setActiveType('workspace');
    setActiveWorkspaceId(workspaceId);
  }, []);

  // Close workspace
  const closeWorkspace = useCallback((workspaceId: string) => {
    setOpenWorkspaces(prev => prev.filter(id => id !== workspaceId));

    // If closing the active workspace, switch to another
    if (activeWorkspaceId === workspaceId) {
      const remaining = openWorkspaces.filter(id => id !== workspaceId);
      if (remaining.length > 0) {
        // Switch to last opened workspace
        setActiveWorkspaceId(remaining[remaining.length - 1]);
      } else {
        // No other workspace, switch to system container
        setActiveType('system');
        setActiveWorkspaceId(null);
      }
    }

    // Clean up lastActiveWorkspaceId
    if (lastActiveWorkspaceId === workspaceId) {
      setLastActiveWorkspaceId(null);
    }
  }, [activeWorkspaceId, openWorkspaces, lastActiveWorkspaceId]);

  // Check if workspace is already open
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
