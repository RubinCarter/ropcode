import React, { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ContainerManager } from '@/components/containers';
import { useContainerContext } from '@/contexts/ContainerContext';
import { useSystemTabContext } from '@/contexts/SystemTabContext';

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
 * MainLayout component - Main application layout with sidebar and container management
 *
 * Layout structure:
 * ┌────────────────────────────────────────────────┐
 * │ Sidebar  │  Container Area                     │
 * │          │  ┌────────────────────────────────┐ │
 * │ Nav Icons│  │  SystemContainer / Workspace   │ │
 * │          │  │  Container                     │ │
 * │ - Proj1  │  │  (with tabs and right sidebar) │ │
 * │ - Proj2  │  │                                │ │
 * │          │  │                                │ │
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
  const { switchToSystem } = useContainerContext();
  const { activateTab } = useSystemTabContext();

  // Wrap navigation callbacks to use container system
  const handleSettingsClick = () => {
    switchToSystem();
    activateTab('settings');
    onSettingsClick?.();
  };

  const handleAgentsClick = () => {
    switchToSystem();
    activateTab('agents');
    onAgentsClick?.();
  };

  const handleUsageClick = () => {
    switchToSystem();
    activateTab('usage');
    onUsageClick?.();
  };

  const handleClaudeClick = () => {
    switchToSystem();
    activateTab('claude-md');
    onClaudeClick?.();
  };

  const handleMCPClick = () => {
    switchToSystem();
    activateTab('mcp');
    onMCPClick?.();
  };

  return (
    <div className={`h-full flex ${className || ''}`}>
      {/* Left Sidebar - Navigation + Projects */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        onSettingsClick={handleSettingsClick}
        onAgentsClick={handleAgentsClick}
        onUsageClick={handleUsageClick}
        onClaudeClick={handleClaudeClick}
        onMCPClick={handleMCPClick}
        onInfoClick={handleInfoClick}
      />

      {/* Container Area - Manages System and Workspace containers */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ContainerManager />
      </div>
    </div>
  );
};

export default MainLayout;
