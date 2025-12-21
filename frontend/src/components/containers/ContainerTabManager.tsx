import React from 'react';
import { useContainerContext } from '@/contexts/ContainerContext';
import { SystemTabManager } from './SystemTabManager';
import { WorkspaceTabManager } from './WorkspaceTabManager';
import { cn } from '@/lib/utils';

interface ContainerTabManagerProps {
  className?: string;
}

/**
 * ContainerTabManager - 根据当前激活的容器类型显示对应的 TabManager
 *
 * - activeType === 'system' 时显示 SystemTabManager
 * - activeType === 'workspace' 时显示 WorkspaceTabManager
 *
 * 注意：WorkspaceTabManager 需要在 WorkspaceTabProvider 内部才能工作，
 * 所以它需要从 WorkspaceContainer 内部渲染。这里我们使用一个 portal 或事件机制
 * 来协调。
 *
 * 由于 WorkspaceTabContext 是在每个 WorkspaceContainer 内部创建的，
 * 而 CustomTitlebar 在外部，我们需要一个不同的方法：
 * 1. 将 TabManager 放在各自的容器内
 * 2. 或者使用一个全局注册机制
 *
 * 这里我们选择方案 1：各容器内部渲染自己的 TabManager，
 * 然后通过 portal 或绝对定位将其显示在标题栏位置。
 *
 * 但为了简化，这里暂时只渲染 SystemTabManager，
 * WorkspaceTabManager 由各 WorkspaceContainer 内部处理。
 */
export const ContainerTabManager: React.FC<ContainerTabManagerProps> = ({ className }) => {
  const { activeType } = useContainerContext();

  // 当 activeType 是 'system' 时，显示 SystemTabManager
  // 当 activeType 是 'workspace' 时，WorkspaceTabManager 会从 WorkspaceContainer 内部显示
  // 这里返回 null，由 WorkspaceContainer 内部处理
  if (activeType === 'workspace') {
    // WorkspaceTabManager 需要在 WorkspaceTabProvider 内部
    // 所以这里返回一个占位符，实际由 WorkspaceContainer 通过 portal 渲染
    return <div id="workspace-tab-manager-slot" className={cn("flex items-stretch", className)} />;
  }

  return <SystemTabManager className={className} />;
};

export default ContainerTabManager;
