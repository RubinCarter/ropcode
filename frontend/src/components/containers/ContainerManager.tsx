import React from 'react';
import { useContainerContext } from '@/contexts/ContainerContext';
import { SystemContainer } from './SystemContainer';
import { WorkspaceContainer } from './WorkspaceContainer';

export const ContainerManager: React.FC = () => {
  const { activeType, activeWorkspaceId, openWorkspaces } = useContainerContext();

  return (
    <div className="flex-1 h-full relative">
      {/* 系统容器 */}
      <SystemContainer visible={activeType === 'system'} />

      {/* Workspace 容器们 */}
      {openWorkspaces.map(workspaceId => (
        <WorkspaceContainer
          key={workspaceId}
          workspaceId={workspaceId}
          visible={activeType === 'workspace' && activeWorkspaceId === workspaceId}
        />
      ))}
    </div>
  );
};

export default ContainerManager;
