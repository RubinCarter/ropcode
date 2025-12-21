import React, { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TabContent } from '@/components/TabContent';
import { RightSidebar } from '@/components/right-sidebar';
import { useTabContext } from '@/contexts/TabContext';
import { STATELESS_TAB_TYPES } from '@/lib/tabUtils';

interface MainLayoutProps {
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Navigation callbacks
   */
  onSettingsClick?: () => void;
  onAgentsClick?: () => void;
  onUsageClick?: () => void;
  onClaudeClick?: () => void;
  onMCPClick?: () => void;
  onInfoClick?: () => void;
}

/**
 * MainLayout component - Main application layout with sidebar and content area
 *
 * Layout structure:
 * ┌────────────────────────────────────────────────┐
 * │ Sidebar  │  Content Area  │  RightSidebar      │
 * │          │  ┌──────────┐  │  ┌──────────────┐  │
 * │ Nav Icons│  │TabManager│  │  │  Terminal    │  │
 * │          │  ├──────────┤  │  ├──────────────┤  │
 * │ - Proj1  │  │TabContent│  │  │  $ command   │  │
 * │ - Proj2  │  │          │  │  │  output...   │  │
 * │          │  │          │  │  │              │  │
 * └────────────────────────────────────────────────┘
 */
export const MainLayout: React.FC<MainLayoutProps> = ({
  className,
  onSettingsClick,
  onAgentsClick,
  onUsageClick,
  onClaudeClick,
  onMCPClick,
  onInfoClick
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const { activeTabId, getTabById } = useTabContext();

  // Get current active tab
  const activeTab = activeTabId ? getTabById(activeTabId) : undefined;

  // 持久化上一次有效的项目路径，避免在 Settings 等无状态标签页切换时重置终端状态
  const lastProjectPathRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!activeTab) return;
    const path = activeTab.projectPath || activeTab.initialProjectPath;
    if (path) {
      lastProjectPathRef.current = path;
    }
  }, [activeTab]);

  // 计算右侧栏是否应该真正显示（统一的显示逻辑）
  const shouldShowRightSidebar = React.useMemo(() => {
    return !!(
      activeTab &&
      !STATELESS_TAB_TYPES.has(activeTab.type) &&
      rightSidebarOpen
    );
  }, [activeTab, rightSidebarOpen]);

  // 监听活跃 tab 变化
  React.useEffect(() => {
    if (activeTab) {
      const projectPath = activeTab.projectPath || activeTab.initialProjectPath;
      console.log('[MainLayout] 📑 活跃 tab 变化:', {
        tabId: activeTab.id,
        tabType: activeTab.type,
        projectPath,
        shouldShowRightSidebar
      });
    }
  }, [activeTab, shouldShowRightSidebar]);

  // 监听右侧栏切换事件
  React.useEffect(() => {
    const handleToggleRightSidebar = () => {
      setRightSidebarOpen(prev => !prev);
    };

    window.addEventListener('toggle-right-sidebar', handleToggleRightSidebar);
    return () => {
      window.removeEventListener('toggle-right-sidebar', handleToggleRightSidebar);
    };
  }, []);

  // 广播右侧栏状态变化（包含真实的显示状态）
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('right-sidebar-state-changed', {
      detail: {
        isOpen: rightSidebarOpen,
        shouldShow: shouldShowRightSidebar // 添加实际显示状态
      }
    }));
  }, [rightSidebarOpen, shouldShowRightSidebar]);

  return (
    <div className={`h-full flex ${className || ''}`}>
      {/* Left Sidebar - Navigation + Projects */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        onSettingsClick={onSettingsClick}
        onAgentsClick={onAgentsClick}
        onUsageClick={onUsageClick}
        onClaudeClick={onClaudeClick}
        onMCPClick={onMCPClick}
        onInfoClick={onInfoClick}
      />

      {/* Center Content Area - Tab Content Only */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabContent />
      </div>

      {/* Right Sidebar - Interactive Terminal */}
      {/* 保持挂载，仅在需要时显示，避免切到 Settings 时重新初始化 */}
      <RightSidebar
        isOpen={shouldShowRightSidebar}
        onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
        currentProjectPath={lastProjectPathRef.current}
      />
    </div>
  );
};

export default MainLayout;
