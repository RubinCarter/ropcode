import React from 'react';
import { useContainerContext } from '@/contexts/ContainerContext';
import { SystemTabManager } from './SystemTabManager';
import { WorkspaceTabManager } from './WorkspaceTabManager';
import { cn } from '@/lib/utils';

interface ContainerTabManagerProps {
  className?: string;
}

/**
 * ContainerTabManager - Shows the corresponding TabManager based on current active container type
 *
 * - Shows SystemTabManager when activeType === 'system'
 * - Shows WorkspaceTabManager when activeType === 'workspace'
 *
 * Note: WorkspaceTabManager must be inside WorkspaceTabProvider to work,
 * so it needs to render from inside WorkspaceContainer. We use a portal or event mechanism
 * to coordinate.
 *
 * Since WorkspaceTabContext is created inside each WorkspaceContainer,
 * and CustomTitlebar is outside, we need a different approach:
 * 1. Render TabManager inside their respective containers
 * 2. Or use a global registration mechanism
 *
 * We choose approach 1: each container renders its own TabManager,
 * then via portal or absolute positioning renders it in the titlebar position.
 *
 * For simplicity, we only render SystemTabManager here,
 * WorkspaceTabManager is handled inside each WorkspaceContainer.
 */
export const ContainerTabManager: React.FC<ContainerTabManagerProps> = ({ className }) => {
  const { activeType } = useContainerContext();

  // When activeType is 'system', show SystemTabManager
  // When activeType is 'workspace', WorkspaceTabManager is shown from inside WorkspaceContainer
  // Return null here, handled inside WorkspaceContainer
  if (activeType === 'workspace') {
    // WorkspaceTabManager must be inside WorkspaceTabProvider
    // Return a placeholder here, actual rendering done by WorkspaceContainer via portal
    return <div id="workspace-tab-manager-slot" className={cn("flex items-stretch", className)} />;
  }

  return <SystemTabManager className={className} />;
};

export default ContainerTabManager;
