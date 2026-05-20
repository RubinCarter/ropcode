import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ProjectList } from '@/components/ProjectList';
import { api, type Project } from '@/lib/api';
import { wsClient } from '@/lib/ws-rpc-client';
import { cn } from '@/lib/utils';
import { useTabContext } from '@/contexts/TabContext';
import { useContainerContext } from '@/contexts/ContainerContext';
import { SyncFromSSHDialog } from '@/components/SyncFromSSHDialog';
import { CloneFromURLDialog } from '@/components/CloneFromURLDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';
import { SidebarRail, type SidebarPanelMode } from '@/components/sidebar/SidebarRail';
import { SessionPanel } from '@/components/sidebar/SessionPanel';
import { findSelectedSpace, selectedSpaceFromProject, type SelectedSpace } from '@/components/sidebar/sidebarSelection';

const SIDEBAR_RAIL_WIDTH = 64;
const SIDEBAR_DEFAULT_WIDTH = 360;
const SIDEBAR_MIN_WIDTH = 304;
const SIDEBAR_MAX_WIDTH = 640;

const clampSidebarWidth = (width: number) => {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
};

interface SidebarProps {
  /**
   * Whether the sidebar is collapsed
   */
  isCollapsed?: boolean;
  /**
   * Callback when collapse state changes
   */
  onCollapse?: (collapsed: boolean) => void;
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
 * Sidebar component - compact companion navigation and one fixed left panel.
 */
export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed: externalCollapsed,
  onCollapse,
  className,
  onSettingsClick,
  onAgentsClick,
  onUsageClick,
  onClaudeClick,
  onMCPClick,
  onInfoClick
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar_width_px');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed)) {
        return clampSidebarWidth(parsed);
      }
    } catch {
      // Ignore storage failures and use the default width.
    }
    return SIDEBAR_DEFAULT_WIDTH;
  });
  const [panelMode, setPanelModeState] = useState<SidebarPanelMode>(() => {
    try {
      const saved = localStorage.getItem('sidebar_panel_mode');
      return saved === 'sessions' ? 'sessions' : 'projects';
    } catch {
      return 'projects';
    }
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<SelectedSpace | null>(null);
  const [showSSHDialog, setShowSSHDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showOpenDialog, setShowOpenDialog] = useState(false);

  const { tabs, activeTabId } = useTabContext();
  const { switchToWorkspace, activeWorkspaceId, activeType } = useContainerContext();
  const activeProjectPath = activeType === 'workspace' ? activeWorkspaceId : null;
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const isCollapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  const setPanelMode = useCallback((nextMode: SidebarPanelMode) => {
    setPanelModeState(nextMode);
    try {
      localStorage.setItem('sidebar_panel_mode', nextMode);
    } catch (err) {
      console.warn('Failed to save sidebar panel mode:', err);
    }
  }, []);

  const startSidebarResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isCollapsed) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setSidebarWidth(nextWidth);
      window.dispatchEvent(new CustomEvent('sidebar-width-changed', {
        detail: { width: nextWidth }
      }));
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const finalWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX);
      setSidebarWidth(finalWidth);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem('sidebar_width_px', String(finalWidth));
      } catch (err) {
        console.warn('Failed to save sidebar width:', err);
      }
      window.dispatchEvent(new CustomEvent('sidebar-width-changed', {
        detail: { width: finalWidth }
      }));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [isCollapsed, sidebarWidth]);

  const loadProjects = useCallback(async () => {
    if (!wsClient.isConnected()) {
      try {
        await wsClient.waitForConnection(5000);
      } catch {
        setLoading(false);
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      const projectList = await api.listProjects();
      setProjects(projectList ?? []);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    const unsub = wsClient.onConnect(() => {
      loadProjects();
    });
    return unsub;
  }, [loadProjects]);

  useEffect(() => {
    const nextSelectedSpace = findSelectedSpace(projects, activeProjectPath);
    if (nextSelectedSpace) {
      setSelectedSpace(prev => prev?.path === nextSelectedSpace.path ? prev : nextSelectedSpace);
    }
  }, [activeProjectPath, projects]);

  const handleProjectClick = useCallback((project: Project) => {
    const nextSpace = selectedSpaceFromProject(project);
    if (nextSpace) {
      setSelectedSpace(nextSpace);
    }
    switchToWorkspace(project.path);
  }, [switchToWorkspace]);

  const handleCreateWorkspace = useCallback(async (project: Project) => {
    const { generateWorkspaceName } = await import('@/lib/nameGenerator');

    try {
      const name = generateWorkspaceName();
      await api.createWorkspace(project.path, name, name);

      const projectList = await api.listProjects();
      setProjects(projectList ?? []);

      const updatedProject = projectList.find(p => p.path === project.path);
      const newWorkspace = updatedProject?.workspaces?.find(ws => ws.name === name || ws.branch === name);
      const provider = newWorkspace?.providers?.find(p => p.provider_id === 'claude')
        ?? newWorkspace?.providers?.find(p => p.provider_id === 'codex')
        ?? newWorkspace?.providers?.[0];

      if (provider?.path) {
        const projectLabel = selectedSpaceFromProject(project)?.projectLabel ?? project.path;
        setSelectedSpace({
          path: provider.path,
          label: newWorkspace?.branch || newWorkspace?.name || name,
          projectPath: project.path,
          projectLabel,
        });
        switchToWorkspace(provider.path);
      } else {
        console.error('Failed to find newly created workspace path');
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  }, [switchToWorkspace]);

  const toggleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed;
    if (onCollapse) {
      onCollapse(newCollapsed);
    } else {
      setInternalCollapsed(newCollapsed);
    }

    window.dispatchEvent(new CustomEvent('sidebar-collapsed', {
      detail: { collapsed: newCollapsed }
    }));

    try {
      localStorage.setItem('sidebar_collapsed', String(newCollapsed));
    } catch (err) {
      console.warn('Failed to save sidebar state:', err);
    }
  }, [isCollapsed, onCollapse]);

  useEffect(() => {
    if (externalCollapsed === undefined) {
      try {
        const saved = localStorage.getItem('sidebar_collapsed');
        if (saved !== null) {
          setInternalCollapsed(saved === 'true');
        }
      } catch (err) {
        console.warn('Failed to load sidebar state:', err);
      }
    }
  }, [externalCollapsed]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sidebar-width-changed', {
      detail: { width: isCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth }
    }));
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    window.addEventListener('toggle-sidebar', toggleCollapse);
    return () => {
      window.removeEventListener('toggle-sidebar', toggleCollapse);
    };
  }, [toggleCollapse]);

  return (
    <motion.div
      initial={false}
      animate={{
        width: isCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth
      }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={cn(
        'relative h-full min-w-16 flex bg-background border-r border-border/50',
        className
      )}
      style={{ flexShrink: 0, width: isCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth }}
    >
      <SidebarRail
        mode={panelMode}
        collapsed={isCollapsed}
        activeSystemTabType={activeTab?.type}
        onModeChange={setPanelMode}
        onToggleCollapse={toggleCollapse}
        onToggleRightSidebar={() => window.dispatchEvent(new CustomEvent('toggle-right-sidebar'))}
        onOpenProject={() => setShowOpenDialog(true)}
        onCloneProject={() => setShowCloneDialog(true)}
        onSyncFromSSH={() => setShowSSHDialog(true)}
        onAgentsClick={onAgentsClick}
        onUsageClick={onUsageClick}
        onSettingsClick={onSettingsClick}
        onClaudeClick={onClaudeClick}
        onMCPClick={onMCPClick}
        onInfoClick={onInfoClick}
      />

      {!isCollapsed && (
        <div
          className="h-full min-w-0 flex flex-col border-l border-border/50"
          style={{ width: sidebarWidth - SIDEBAR_RAIL_WIDTH }}
        >
          {panelMode === 'projects' ? (
            <>
              {error && (
                <div className="flex-shrink-0 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <ProjectList
                projects={projects}
                onProjectClick={handleProjectClick}
                onOpenProject={() => setShowOpenDialog(true)}
                onCreateWorkspace={handleCreateWorkspace}
                onRefresh={loadProjects}
                loading={loading}
                activeProjectPath={activeProjectPath}
                showInlineSessions={false}
                onSelectedSpaceChange={setSelectedSpace}
                className="border-0"
              />
            </>
          ) : (
            <SessionPanel
              selectedSpacePath={selectedSpace?.path ?? null}
              selectedSpaceLabel={selectedSpace?.label ?? null}
              selectedProjectLabel={selectedSpace?.projectLabel ?? null}
              onSwitchToWorkspace={switchToWorkspace}
            />
          )}
        </div>
      )}

      <SyncFromSSHDialog
        isOpen={showSSHDialog}
        onClose={() => setShowSSHDialog(false)}
        onSuccess={loadProjects}
      />

      <CloneFromURLDialog
        isOpen={showCloneDialog}
        onClose={() => setShowCloneDialog(false)}
        onSuccess={loadProjects}
      />

      <OpenProjectDialog
        isOpen={showOpenDialog}
        onClose={() => setShowOpenDialog(false)}
        onSuccess={(project) => {
          loadProjects();
          handleProjectClick(project);
        }}
      />

      {!isCollapsed && (
        <div
          className="absolute right-0 top-0 bottom-0 z-30 w-1 cursor-col-resize hover:bg-primary/40 transition-colors"
          onMouseDown={startSidebarResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
    </motion.div>
  );
};

export default Sidebar;
