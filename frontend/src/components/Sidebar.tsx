import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Plus, Bot, BarChart3, Settings, MoreVertical, FileText, Network, Info, GitBranch, Server, ChevronDown, PanelLeft, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProjectList } from '@/components/ProjectList';
import { api, type Project } from '@/lib/api';
import { wsClient } from '@/lib/ws-rpc-client';
import { cn } from '@/lib/utils';
import { useTabContext } from '@/contexts/TabContext';
import { useContainerContext } from '@/contexts/ContainerContext';
import { TooltipProvider, TooltipSimple } from '@/components/ui/tooltip-modern';
import { SyncFromSSHDialog } from '@/components/SyncFromSSHDialog';
import { CloneFromURLDialog } from '@/components/CloneFromURLDialog';
import { OpenProjectDialog } from '@/components/OpenProjectDialog';

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
 * Sidebar component - Left panel showing project list
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showSSHDialog, setShowSSHDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showOpenDialog, setShowOpenDialog] = useState(false);

  // 🔥 关键：使用容器上下文来确定侧边栏高亮的 project
  const { tabs, activeTabId } = useTabContext();
  const { switchToWorkspace, activeWorkspaceId, activeType } = useContainerContext();
  const activeProjectPath = activeType === 'workspace' ? activeWorkspaceId : null;

  // 获取实际当前激活的 Tab（用于按钮高亮）
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Use external collapsed state if provided, otherwise use internal
  const isCollapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  /**
   * Load all projects
   */
  const loadProjects = async () => {
    // 等待 WebSocket 连接就绪
    if (!wsClient.isConnected()) {
      try {
        await wsClient.waitForConnection(5000);
      } catch {
        // 连接超时，跳过加载
        setLoading(false);
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      const projectList = await api.listProjects();
      setProjects(projectList);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle project click - switch to workspace using container context
   */
  const handleProjectClick = async (project: Project) => {
    // 直接调用容器上下文的 switchToWorkspace
    switchToWorkspace(project.path);
  };

  /**
   * Handle open project folder picker
   */
  const handleOpenProject = () => {
    setShowOpenDialog(true);
  };;;;;

  /**
   * Handle create workspace
   */
  const handleCreateWorkspace = async (project: Project) => {
    // Import the workspace creation logic
    const { generateWorkspaceName } = await import('@/lib/nameGenerator');

    try {
      const name = generateWorkspaceName(); // 形容词-动物格式，如：clever-tiger
      // Create workspace with branch and session name (createWorkspace returns void)
      await api.createWorkspace(
        project.path,
        name, // branch name
        name  // session name
      );

      // Reload projects list to get the new workspace with correct path from backend
      const projectList = await api.listProjects();
      setProjects(projectList);

      // Find the newly created workspace from the refreshed project list
      const updatedProject = projectList.find(p => p.path === project.path);
      const newWorkspace = updatedProject?.workspaces?.find(ws => ws.name === name || ws.branch === name);
      const claudeProvider = newWorkspace?.providers?.find(p => p.provider_id === 'claude');

      if (claudeProvider?.path) {
        // Use the actual path from backend
        switchToWorkspace(claudeProvider.path);
      } else {
        console.error('Failed to find newly created workspace path');
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  };

  /**
   * Toggle collapsed state
   */
  const toggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    if (onCollapse) {
      onCollapse(newCollapsed);
    } else {
      setInternalCollapsed(newCollapsed);
    }

    // Broadcast collapse state change
    window.dispatchEvent(new CustomEvent('sidebar-collapsed', {
      detail: { collapsed: newCollapsed }
    }));

    // Save preference to localStorage
    try {
      localStorage.setItem('sidebar_collapsed', String(newCollapsed));
    } catch (err) {
      console.warn('Failed to save sidebar state:', err);
    }
  };

  // Load collapsed state from localStorage on mount
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

  // Listen for toggle sidebar event
  useEffect(() => {
    const handleToggleSidebar = () => {
      toggleCollapse();
    };

    window.addEventListener('toggle-sidebar', handleToggleSidebar);
    return () => {
      window.removeEventListener('toggle-sidebar', handleToggleSidebar);
    };
  }, [isCollapsed, onCollapse]);


  return (
    <motion.div
      initial={false}
      animate={{
        width: isCollapsed ? '3%' : '20%'
      }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={cn(
        'h-full bg-background border-r border-border/50 flex flex-col min-w-[48px]',
        className
      )}
      style={{ flexShrink: 0 }}
    >
      {/* Sidebar Header */}
      <TooltipProvider>
        <div className={cn(
          "flex items-center p-3 border-b border-border/50 flex-shrink-0",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          {/* Sidebar toggle buttons - always visible */}
          <div className={cn(
            "flex items-center gap-0.5",
            isCollapsed && "flex-col"
          )}>
            <TooltipSimple content={isCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"} side="right">
              <motion.button
                onClick={toggleCollapse}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <PanelLeft size={16} />
              </motion.button>
            </TooltipSimple>
            <TooltipSimple content="Toggle right sidebar (⌘J)" side="right">
              <motion.button
                onClick={() => window.dispatchEvent(new CustomEvent('toggle-right-sidebar'))}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <PanelRight size={16} />
              </motion.button>
            </TooltipSimple>
          </div>

          {/* Rest of menu - only when expanded */}
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              {/* Primary actions */}
              <div className="flex items-center gap-0.5">
                {onAgentsClick && (
                  <TooltipSimple content="Agents" side="right">
                    <motion.button
                      onClick={onAgentsClick}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors",
                        activeTab?.type === 'agents' && "bg-accent text-accent-foreground shadow-sm"
                      )}
                    >
                      <Bot size={16} />
                    </motion.button>
                  </TooltipSimple>
                )}

                {onUsageClick && (
                  <TooltipSimple content="Usage Dashboard" side="right">
                    <motion.button
                      onClick={onUsageClick}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors",
                        activeTab?.type === 'usage' && "bg-accent text-accent-foreground shadow-sm"
                      )}
                    >
                      <BarChart3 size={16} />
                    </motion.button>
                  </TooltipSimple>
                )}
              </div>

              {/* Visual separator */}
              <div className="w-px h-4 bg-border/50" />

              {/* Secondary actions */}
              <div className="flex items-center gap-0.5">
                {onSettingsClick && (
                  <TooltipSimple content="Settings" side="right">
                    <motion.button
                      onClick={onSettingsClick}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors",
                        activeTab?.type === 'settings' && "bg-accent text-accent-foreground shadow-sm"
                      )}
                    >
                      <Settings size={16} />
                    </motion.button>
                  </TooltipSimple>
                )}

                {/* More options dropdown */}
                <div className="relative">
                  <TooltipSimple content="More options" side="right">
                    <motion.button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        "p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors",
                        (activeTab?.type === 'claude-md' || activeTab?.type === 'mcp') && "bg-accent text-accent-foreground shadow-sm"
                      )}
                    >
                      <MoreVertical size={16} />
                    </motion.button>
                  </TooltipSimple>

                  {isDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-[250]">
                      <div className="py-1">
                        {onClaudeClick && (
                          <button
                            onClick={() => {
                              onClaudeClick();
                              setIsDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3",
                              activeTab?.type === 'claude-md' && "bg-accent text-accent-foreground"
                            )}
                          >
                            <FileText size={14} />
                            <span>Memory</span>
                          </button>
                        )}

                        {onMCPClick && (
                          <button
                            onClick={() => {
                              onMCPClick();
                              setIsDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3",
                              activeTab?.type === 'mcp' && "bg-accent text-accent-foreground"
                            )}
                          >
                            <Network size={14} />
                            <span>MCP Servers</span>
                          </button>
                        )}

                        {onInfoClick && (
                          <button
                            onClick={() => {
                              onInfoClick();
                              setIsDropdownOpen(false);
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-3"
                          >
                            <Info size={14} />
                            <span>About</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {!isCollapsed ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {error && (
                <div className="p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <ProjectList
                projects={projects}
                onProjectClick={handleProjectClick}
                onOpenProject={handleOpenProject}
                onCreateWorkspace={handleCreateWorkspace}
                onRefresh={loadProjects}
                loading={loading}
                activeProjectPath={activeProjectPath}
                className="border-0"
              />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-center py-4 gap-3"
            >
              {/* Collapsed state - show icon buttons */}
              <Button
                onClick={handleOpenProject}
                size="sm"
                variant="ghost"
                className="h-9 w-9 p-0"
                title="Open project"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>

              {projects.slice(0, 5).map((project) => (
                <Button
                  key={project.id}
                  onClick={() => handleProjectClick(project)}
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 font-mono text-xs"
                  title={project.path.split('/').pop() || project.path}
                >
                  {(project.path.split('/').pop() || 'P')[0].toUpperCase()}
                </Button>
              ))}

              {projects.length > 5 && (
                <div className="text-sm text-muted-foreground">
                  +{projects.length - 5}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sidebar Footer - Add project dropdown */}
      {!isCollapsed && (
        <div className="p-3 border-t border-border/50 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="w-full flex items-center gap-2 h-8"
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm">Add Project</span>
                <ChevronDown className="h-4 w-4 ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleOpenProject}>
                <FolderOpen className="w-4 h-4 mr-2" />
                Open Project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowCloneDialog(true)}>
                <GitBranch className="w-4 h-4 mr-2" />
                Clone from URL
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSSHDialog(true)}>
                <Server className="w-4 h-4 mr-2" />
                From SSH
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* SSH Sync Dialog */}
      <SyncFromSSHDialog
        isOpen={showSSHDialog}
        onClose={() => setShowSSHDialog(false)}
        onSuccess={loadProjects}
      />

      {/* Clone From URL Dialog */}
      <CloneFromURLDialog
        isOpen={showCloneDialog}
        onClose={() => setShowCloneDialog(false)}
        onSuccess={loadProjects}
      />

      {/* Open Project Dialog */}
      <OpenProjectDialog
        isOpen={showOpenDialog}
        onClose={() => setShowOpenDialog(false)}
        onSuccess={(project) => {
          loadProjects();
          handleProjectClick(project);
        }}
      />
    </motion.div>
  );
};

export default Sidebar;
