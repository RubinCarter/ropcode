// @ts-nocheck
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, ChevronDown, GitBranch, Trash2, Plus, Clock, AlertTriangle, Server, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Project, AutoSyncStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { api, listen } from "@/lib/api";
import { useTabContext } from "@/contexts/TabContext";
import { useWorkspaceTodo } from "@/contexts/WorkspaceTodoContext";
import { useContainerContext } from "@/contexts/ContainerContext";
import { useProcessChanged } from "@/hooks";

interface ProjectListProps {
  /**
   * Array of projects to display
   */
  projects: Project[];
  /**
   * Callback when a project is clicked
   */
  onProjectClick: (project: Project) => void;
  /**
   * Callback when open project is clicked
   */
  onOpenProject?: () => void | Promise<void>;
  /**
   * Callback when a workspace is created
   */
  onCreateWorkspace?: (project: Project) => void | Promise<void>;
  /**
   * Callback to refresh the projects list
   */
  onRefresh?: () => void | Promise<void>;
  /**
   * Whether the list is currently loading
   */
  loading?: boolean;
  /**
   * The path of the currently active project/workspace
   */
  activeProjectPath?: string;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * Extracts the project name from the full path
 * Works with both Unix (/) and Windows (\) path separators
 */
const getProjectName = (path: string | undefined): string => {
  if (!path) return 'Unknown Project';
  // Handle both Unix and Windows path separators
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
};

/**
 * Formats path to be more readable - shows full path relative to home
 * Truncates long paths with ellipsis in the middle
 * Works with both Unix (/) and Windows (\) path separators
 */
const getDisplayPath = (path: string | undefined, maxLength: number = 30): string => {
  if (!path) return 'Unknown Path';
  // Normalize path separators for consistent handling
  const normalizedPath = path.replace(/\\/g, '/');

  // Try to make path home-relative
  let displayPath = normalizedPath;
  const homeIndicators = ['/Users/', '/home/', 'C:/Users/', 'C:/Documents and Settings/'];
  for (const indicator of homeIndicators) {
    if (normalizedPath.includes(indicator)) {
      const parts = normalizedPath.split('/');
      const userIndex = parts.findIndex((_part, i) =>
        i > 0 && parts[i - 1] === indicator.split('/').filter(Boolean)[indicator.split('/').filter(Boolean).length - 1]
      );
      if (userIndex > 0) {
        const relativePath = parts.slice(userIndex + 1).join('/');
        displayPath = `~/${relativePath}`;
        break;
      }
    }
  }

  // Truncate if too long
  if (displayPath.length > maxLength) {
    const start = displayPath.substring(0, Math.floor(maxLength / 2) - 2);
    const end = displayPath.substring(displayPath.length - Math.floor(maxLength / 2) + 2);
    return `${start}...${end}`;
  }

  return displayPath;
};

/**
 * Formats a timestamp to relative time (e.g., "5m ago", "3h ago", "2d ago")
 */
const formatTimeAgo = (timestamp: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
};

/**
 * ProjectList component - Displays recent projects in a Cursor-like interface
 * 
 * @example
 * <ProjectList
 *   projects={projects}
 *   onProjectClick={(project) => console.log('Selected:', project)}
 *   onOpenProject={() => console.log('Open project')}
 * />
 */
export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onProjectClick,
  onOpenProject,
  onCreateWorkspace,
  onRefresh,
  activeProjectPath,
  className,
}) => {
  const { tabs, removeTab } = useTabContext();
  const { getInProgressTodos, getWorkspaceStatus, setWorkspaceStatus, markAsRead, clearWorkspace } = useWorkspaceTodo();
  const { closeWorkspace, isWorkspaceOpen } = useContainerContext();
  const [showAll, setShowAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [removingWorkspaces, setRemovingWorkspaces] = useState<Set<string>>(new Set());
  const [creatingWorkspaces, setCreatingWorkspaces] = useState<Map<string, { projectId: string; name: string }>>(new Map());
  const [pendingDeleteWorkspaces, setPendingDeleteWorkspaces] = useState<Set<string>>(new Set());
  // Global running states for all workspaces (path -> running status)
  const [workspaceRunningStates, setWorkspaceRunningStates] = useState<Map<string, boolean>>(new Map());
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sshSyncMap, setSshSyncMap] = useState<Record<string, { direction: 'upload' | 'download'; percent: number }>>({});
  const [autoSyncStatuses, setAutoSyncStatuses] = useState<Record<string, AutoSyncStatus>>({});
  const [removingProjects, setRemovingProjects] = useState<Set<string>>(new Set());
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Listen SSH sync progress to show up/down in list
  useEffect(() => {
    const cleanup = listen<any>('ssh-sync-progress', (p) => {
      if (!p) return;
      if (p.stage === 'downloading' && p.projectPath) {
        setSshSyncMap(prev => ({ ...prev, [p.projectPath]: { direction: p.direction || 'download', percent: Math.round(p.percentage || 0) } }));
      } else if ((p.stage === 'completed' || p.stage === 'error') && p.projectPath) {
        setSshSyncMap(prev => { const n = { ...prev }; delete n[p.projectPath]; return n; });
      }
    });
    return cleanup;
  }, []);

  // Check auto sync status for SSH projects
  useEffect(() => {
    const checkAutoSyncStatuses = async () => {
      const sshProjects = projects.filter(p => p.project_type === 'ssh');
      const statuses: Record<string, AutoSyncStatus> = {};

      for (const project of sshProjects) {
        try {
          const status = await api.getAutoSyncStatus(project.id);
          statuses[project.id] = status;
        } catch (err) {
          console.error('Failed to get auto sync status for', project.id, err);
        }
      }

      setAutoSyncStatuses(statuses);
    };

    // Initial status check when component mounts or projects change
    checkAutoSyncStatuses();

    // Use a longer interval (30s) for SSH status checks since they involve remote connections
    // Future improvement: Backend should emit auto-sync events to eliminate polling
    const interval = setInterval(checkAutoSyncStatuses, 30000);
    return () => clearInterval(interval);
  }, [projects]);

  // Listen to auto sync events
  useEffect(() => {
    const unlistenSuccess = listen<any>('auto-sync-success', (data) => {
      const { projectId } = data;
      if (projectId) {
        // Refresh status for this project
        api.getAutoSyncStatus(projectId).then(status => {
          setAutoSyncStatuses(prev => ({ ...prev, [projectId]: status }));
        }).catch(() => {});
      }
    });

    const unlistenError = listen<any>('auto-sync-error', (data) => {
      const { projectId, error } = data;
      if (projectId) {
        setAutoSyncStatuses(prev => ({
          ...prev,
          [projectId]: { ...prev[projectId], error }
        }));
      }
    });

    return () => {
      unlistenSuccess();
      unlistenError();
    };
  }, []);

  // Collect all workspace paths for initial loading
  // Check ALL providers (claude, codex, etc.), not just 'claude'
  const allWorkspacePaths = useMemo(() => {
    const paths: string[] = [];
    projects.forEach(project => {
      if (project.workspaces) {
        project.workspaces.forEach(ws => {
          // Find any AI provider (claude, codex, etc.)
          const aiProvider = ws.providers?.find(p =>
            p.provider_id === 'claude' || p.provider_id === 'codex'
          );
          if (aiProvider) {
            paths.push(aiProvider.path);
          }
        });
      }
    });
    return paths;
  }, [projects]);

  // Initial loading of running state for ALL workspaces
  useEffect(() => {
    if (allWorkspacePaths.length === 0) {
      setWorkspaceRunningStates(new Map());
      return;
    }

    const loadInitialStates = async () => {
      try {
        const results = await Promise.all(
          allWorkspacePaths.map(async (path) => {
            try {
              const running = await api.isClaudeSessionRunningForProject(path);
              return [path, running] as const;
            } catch (err) {
              console.error(`[ProjectList] Failed to check ${path}:`, err);
              return [path, false] as const;
            }
          })
        );

        const newStates = new Map(results);
        setWorkspaceRunningStates(newStates);
      } catch (err) {
        console.error('[ProjectList] Failed to load initial running states:', err);
      }
    };

    // Load initial states once
    loadInitialStates();
  }, [allWorkspacePaths]);

  // Subscribe to process change events (replaces 200ms polling)
  useProcessChanged(undefined, (event) => {
    // Update running state based on event
    setWorkspaceRunningStates(prev => {
      const newStates = new Map(prev);
      if (event.state === 'running') {
        newStates.set(event.cwd, true);
      } else if (event.state === 'stopped') {
        newStates.set(event.cwd, false);
      }
      return newStates;
    });
  });

  // Sync WorkspaceTodoContext status based on actual process state
  // When process is not running but status shows 'working' or 'active', force it to 'idle'
  // This mirrors the stop button logic (query process state directly, not rely on events)
  useEffect(() => {
    workspaceRunningStates.forEach((isRunning, path) => {
      const contextStatus = getWorkspaceStatus(path);

      // If process is not running but status is still 'working' or 'active', force sync to 'idle'
      // This ensures proper transition to 'unread' status via WorkspaceTodoContext
      if (!isRunning && (contextStatus === 'working' || contextStatus === 'active')) {
        console.log('[ProjectList] Force sync: process stopped but status is', contextStatus, ', setting to idle for:', path);
        setWorkspaceStatus(path, 'idle');  // This will trigger working/active → idle → unread transition
      }
    });
  }, [workspaceRunningStates, getWorkspaceStatus, setWorkspaceStatus]);

  // Determine how many projects to show
  const projectsPerPage = showAll ? 10 : 5;
  const totalPages = Math.ceil(projects.length / projectsPerPage);
  
  // Calculate which projects to display
  const startIndex = showAll ? (currentPage - 1) * projectsPerPage : 0;
  const endIndex = startIndex + projectsPerPage;
  const displayedProjects = projects.slice(startIndex, endIndex);
  
  const handleViewAll = () => {
    setShowAll(true);
    setCurrentPage(1);
  };
  
  const handleViewLess = () => {
    setShowAll(false);
    setCurrentPage(1);
  };

  const toggleExpanded = (projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  const handleCreateWorkspace = async (project: Project) => {
    if (onCreateWorkspace) {
      // Generate a temporary ID for the creating workspace
      const tempId = `creating-${Date.now()}`;
      const { generateWorkspaceName } = await import('@/lib/nameGenerator');
      const workspaceName = generateWorkspaceName(); // 形容词-动物格式用于显示，如：clever-tiger

      // Add to creating workspaces immediately
      setCreatingWorkspaces(prev => {
        const newMap = new Map(prev);
        newMap.set(tempId, { projectId: project.id, name: workspaceName });
        return newMap;
      });

      // Ensure the project is expanded to show the new workspace
      setExpandedProjects(prev => new Set(prev).add(project.id));

      try {
        await onCreateWorkspace(project);
      } finally {
        // Remove from creating workspaces after creation completes
        setCreatingWorkspaces(prev => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
      }
    }
  };

  const handleDeleteClick = (workspaceId: string, workspacePath: string) => {
    // 检查是否已经在待删除状态
    if (pendingDeleteWorkspaces.has(workspaceId)) {
      // 第二次点击，执行真正的删除
      handleRemoveWorkspace(workspaceId, workspacePath);
    } else {
      // 第一次点击，标记为待删除
      setPendingDeleteWorkspaces(prev => new Set(prev).add(workspaceId));

      // 3秒后自动取消待删除状态
      setTimeout(() => {
        setPendingDeleteWorkspaces(prev => {
          const newSet = new Set(prev);
          newSet.delete(workspaceId);
          return newSet;
        });
      }, 3000);
    }
  };

  const handleRemoveWorkspace = async (workspaceId: string, workspacePath: string) => {
    // Check if workspace is clean BEFORE marking as removing
    try {
      await api.checkWorkspaceClean(workspacePath);
    } catch (cleanCheckError: any) {
      // Workspace is not clean, show error and abort deletion
      const message = typeof cleanCheckError === 'string'
        ? cleanCheckError
        : cleanCheckError?.message || JSON.stringify(cleanCheckError);

      setErrorMessage(message);
      setErrorDialogOpen(true);

      // Remove from pending delete and abort
      setPendingDeleteWorkspaces(prev => {
        const newSet = new Set(prev);
        newSet.delete(workspaceId);
        return newSet;
      });
      return;
    }

    try {
      // Mark workspace as being removed
      setRemovingWorkspaces(prev => new Set(prev).add(workspaceId));
      // Remove from pending delete
      setPendingDeleteWorkspaces(prev => {
        const newSet = new Set(prev);
        newSet.delete(workspaceId);
        return newSet;
      });

      // Find and close any tabs associated with this workspace
      const tabsToClose = tabs.filter(tab => tab.initialProjectPath === workspacePath);
      tabsToClose.forEach(tab => removeTab(tab.id));

      // Remove the workspace
      await api.removeWorkspace(workspaceId);

      // Clear workspace todos from context
      clearWorkspace(workspacePath);

      // Refresh projects list
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Failed to remove workspace:', error);
    } finally {
      // Remove from removing set
      setRemovingWorkspaces(prev => {
        const newSet = new Set(prev);
        newSet.delete(workspaceId);
        return newSet;
      });
    }
  };

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
    setDeleteProjectDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      // Mark project as being removed
      setRemovingProjects(prev => new Set(prev).add(projectToDelete.id));
      setDeleteProjectDialogOpen(false);

      // Find and close any tabs associated with this project
      const tabsToClose = tabs.filter(tab => tab.initialProjectPath === projectToDelete.path);
      tabsToClose.forEach(tab => removeTab(tab.id));

      // Remove the project from index
      await api.removeProjectFromIndex(projectToDelete.id);

      // Refresh projects list
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Failed to remove project:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove project');
      setErrorDialogOpen(true);
    } finally {
      // Remove from removing set
      setRemovingProjects(prev => {
        const newSet = new Set(prev);
        newSet.delete(projectToDelete.id);
        return newSet;
      });
      setProjectToDelete(null);
    }
  };

  return (
    <div className={cn("h-full overflow-y-auto bg-background", className)}>
      <div className="w-full">{/* Removed max-w constraint for sidebar */}

        {/* Projects List */}
        <div className="py-2">
          {projects.length > 0 ? (
            <div className="space-y-1">
              {[...projects].sort((a, b) => {
                // Sort projects by creation time (descending - newest first)
                // This keeps the project list order stable and predictable
                const timeA = a.created_at || 0;
                const timeB = b.created_at || 0;
                return timeB - timeA;
              }).map((project) => {
                const isExpanded = expandedProjects.has(project.id);
                const hasWorkspaces = project.workspaces && project.workspaces.length > 0;
                const hasGitSupport = project.has_git_support ?? false;

                // Check if project is directly active OR if any of its workspaces are active
                const isProjectDirectlyActive = activeProjectPath === project.path;
                const isProjectActiveViaWorkspace = hasWorkspaces && project.workspaces!.some(ws => {
                  const claudeProvider = ws.providers.find(p => p.provider_id === 'claude');
                  return claudeProvider && activeProjectPath === claudeProvider.path;
                });
                const isProjectActive = isProjectDirectlyActive || isProjectActiveViaWorkspace;

                return (
                <div key={project.id} className="mb-0.5">
                  {/* Project Header */}
                  <div className={cn(
                    "group/project hover:bg-accent/50 transition-colors flex items-center rounded-md",
                    isProjectActive && "bg-accent border-l-2 border-primary"
                  )}>
                    <button
                      onClick={() => onProjectClick(project)}
                      className="flex-1 min-w-0 px-3 py-2 flex items-center gap-2 text-left"
                    >
                      <span className="font-medium text-sm truncate flex items-center gap-2">
                        {/* Project type icon */}
                        <span className="flex-shrink-0 inline-flex items-center justify-center">
                          {project.project_type === 'ssh' ? (
                            <Server className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : project.project_type === 'git' ? (
                            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </span>
                        {isProjectActive && (
                          <div className="flex-shrink-0 h-2 w-2 bg-blue-500 rounded-full border border-background" />
                        )}
                        {getProjectName(project.path)}
                        {sshSyncMap[project.path] && (
                          <span className="ml-1 text-xs text-muted-foreground flex items-center gap-1">
                            {sshSyncMap[project.path].direction === 'upload' ? '↑' : '↓'}
                            <span>{sshSyncMap[project.path].percent}%</span>
                          </span>
                        )}
                      </span>
                    </button>
                    {/* Delete button - only show on hover */}
                    {!removingProjects.has(project.id) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project);
                        }}
                        className="flex-shrink-0 transition-all p-1 mr-1 rounded opacity-0 group-hover/project:opacity-100 hover:bg-destructive/10"
                        title="Remove from list"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    )}
                    {removingProjects.has(project.id) && (
                      <div className="flex-shrink-0 p-1 mr-1">
                        <div className="h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    {/* Workspace 折叠按钮 - 只在有 Git 支持时显示 */}
                    {hasGitSupport && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(project.id);
                        }}
                        className="flex-shrink-0 p-2 hover:bg-accent transition-colors rounded"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 text-muted-foreground transition-transform",
                            isExpanded ? "rotate-0" : "-rotate-90"
                          )}
                        />
                      </button>
                    )}
                  </div>

                  {/* Workspaces List - 只在有 Git 支持时显示 */}
                  <AnimatePresence>
                    {hasGitSupport && isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="py-0.5 ml-2">
                          {/* New Workspace Button - First in list */}
                          <button
                            onClick={() => handleCreateWorkspace(project)}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors rounded-md mb-0.5"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>New workspace</span>
                          </button>

                          {/* Creating Workspaces - Show at the top */}
                          {Array.from(creatingWorkspaces.entries())
                            .filter(([_, info]) => info.projectId === project.id)
                            .map(([tempId, info]) => (
                              <div
                                key={tempId}
                                className="group/workspace transition-colors flex items-center rounded-md opacity-60"
                              >
                                <div className="flex-1 min-w-0 px-3 py-1.5 flex items-start gap-2">
                                  <div className="flex-shrink-0">
                                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm mb-0.5 truncate flex items-center gap-2">
                                      <span className="truncate">{info.name}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      <span className="text-blue-600 dark:text-blue-500">Creating...</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}

                          {hasWorkspaces && [...project.workspaces!].sort((a, b) => {
                            // Sort workspaces by added_at (descending - newest first)
                            return b.added_at - a.added_at;
                          }).map((workspace) => {
                            // Get Claude provider info from workspace
                            const claudeProvider = workspace.providers.find(p => p.provider_id === 'claude');
                            if (!claudeProvider) return null; // Skip if no Claude provider

                            const isActive = activeProjectPath === claudeProvider.path;
                            const isRemoving = removingWorkspaces.has(claudeProvider.id);
                            const isPendingDelete = pendingDeleteWorkspaces.has(claudeProvider.id);

                            // Get workspace status and todos
                            // IMPORTANT: Use path as the unique identifier to match ClaudeCodeSession
                            const contextStatus = getWorkspaceStatus(claudeProvider.path);
                            const inProgressTodos = getInProgressTodos(claudeProvider.path);
                            const firstTodo = inProgressTodos[0];

                            // Get real process running state from global polling
                            const isProcessRunning = workspaceRunningStates.get(claudeProvider.path) ?? false;

                            // Determine final status with clear priority:
                            // 1. If process is actually running → 'working'
                            // 2. Otherwise trust context status (active/unread/idle)
                            let workspaceStatus = contextStatus;
                            if (isProcessRunning) {
                              // Process is running, override idle and unread status
                              if (contextStatus === 'idle' || contextStatus === 'unread') {
                                workspaceStatus = 'working';
                              }
                              // Keep 'working' or 'active' status unchanged
                            }
                            // When process is not running, trust context status
                            // This allows proper transition to 'unread' after completion

                            return (
                            <div
                              key={claudeProvider.id}
                              className={cn(
                                "group/workspace hover:bg-accent/50 transition-colors flex items-center rounded-md",
                                isActive && "bg-accent border-l-2 border-primary",
                                isRemoving && "opacity-60"
                              )}
                            >
                              <button
                                onClick={() => {
                                  if (isRemoving) return;

                                  // Mark as read when clicked if unread
                                  if (workspaceStatus === 'unread') {
                                    markAsRead(claudeProvider.path);
                                  }

                                  const workspaceProject: Project = {
                                    id: claudeProvider.id,
                                    path: claudeProvider.path,
                                    sessions: [],
                                    created_at: workspace.added_at,
                                    last_provider: workspace.last_provider,
                                  };
                                  onProjectClick(workspaceProject);
                                }}
                                disabled={isRemoving}
                                className="flex-1 min-w-0 px-3 py-1.5 flex items-start gap-2 text-left disabled:cursor-not-allowed"
                              >
                                <div className="flex-shrink-0">
                                  {workspaceStatus === 'active' ? (
                                    <Clock className="h-3.5 w-3.5 text-blue-500 mt-0.5 animate-pulse" />
                                  ) : (
                                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm mb-0.5 truncate flex items-center gap-2">
                                    {isActive && !isRemoving && (
                                      <div className="flex-shrink-0 h-2 w-2 bg-blue-500 rounded-full border border-background" />
                                    )}
                                    <span className="truncate">
                                      {workspace.branch || workspace.name}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {isRemoving ? (
                                      <span className="text-yellow-600 dark:text-yellow-500">Removing...</span>
                                    ) : workspaceStatus === 'active' ? (
                                      <span className="text-blue-500 truncate">
                                        {firstTodo.activeForm}
                                      </span>
                                    ) : workspaceStatus === 'working' ? (
                                      <span className="text-purple-500 truncate animate-pulse">Working...</span>
                                    ) : workspaceStatus === 'unread' ? (
                                      <span className="text-orange-500 font-medium">Unread</span>
                                    ) : (
                                      <>{workspace.name}{workspace.name && ' · '}{formatTimeAgo(workspace.added_at)}</>
                                    )}
                                  </div>
                                </div>
                              </button>
                              {/* Close workspace button - only show when workspace is open */}
                              {!isRemoving && isWorkspaceOpen(claudeProvider.path) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    closeWorkspace(claudeProvider.path);
                                  }}
                                  className="flex-shrink-0 transition-all p-1 rounded opacity-0 group-hover/workspace:opacity-100 hover:bg-accent"
                                  title="Close workspace"
                                >
                                  <X className="h-3 w-3 text-muted-foreground" />
                                </button>
                              )}
                              {!isRemoving && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick(claudeProvider.id, claudeProvider.path);
                                  }}
                                  className={cn(
                                    "flex-shrink-0 transition-all p-1 mr-1 rounded",
                                    isPendingDelete
                                      ? "opacity-100 bg-orange-500/20 hover:bg-orange-500/30"
                                      : "opacity-0 group-hover/workspace:opacity-100 hover:bg-destructive/10"
                                  )}
                                >
                                  {isPendingDelete ? (
                                    <AlertTriangle className="h-3 w-3 text-orange-500 animate-pulse" />
                                  ) : (
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  )}
                                </button>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-3">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                No projects yet
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deleteProjectDialogOpen} onOpenChange={setDeleteProjectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Remove Project from List
            </DialogTitle>
            <DialogDescription className="pt-3 text-base">
              This will only remove the project from the list. It will not delete any files from disk.
              <div className="mt-3 p-3 bg-muted/50 rounded-md">
                <p className="text-sm font-medium text-foreground">
                  Project: {projectToDelete?.path}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteProjectDialogOpen(false);
                setProjectToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteProject}
            >
              Remove from List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error Dialog */}
      <Dialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Cannot Delete Workspace
            </DialogTitle>
            <DialogDescription className="pt-3 text-base">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              onClick={() => setErrorDialogOpen(false)}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 
