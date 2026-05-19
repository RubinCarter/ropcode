// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { FolderOpen, ChevronDown, GitBranch, Trash2, Plus, Clock, AlertTriangle, Server, RefreshCw, X, MessageSquare, MessageSquarePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Project, AutoSyncStatus, ProviderSessionSummary } from "@/lib/api";
import type { main } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";
import { api, listen } from "@/lib/api";
import { useTabContext } from "@/contexts/TabContext";
import { useWorkspaceTodo } from "@/contexts/WorkspaceTodoContext";
import { useContainerContext } from "@/contexts/ContainerContext";
import { useProcessChanged } from "@/hooks";
import { basename, homeRelativePath } from "@/lib/pathUtils";
import { generateSessionTitleForSessionViaEvent, generateBranchNameViaEvent } from "@/lib/titleGeneration";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { OpenAIIcon } from "./icons/OpenAIIcon";
import { GeminiIcon } from "./icons/GeminiIcon";

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

const getProjectName = (path: string | undefined): string => {
  return basename(path, 'Unknown Project');
};

/**
 * Formats path to be more readable - shows full path relative to home
 * Truncates long paths with ellipsis in the middle
 */
const getDisplayPath = (path: string | undefined, maxLength: number = 30): string => {
  if (!path) return 'Unknown Path';
  let displayPath = homeRelativePath(path);

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

type SpaceSessionCache = {
  sessions: ProviderSessionSummary[];
  hasMore: boolean;
  loading: boolean;
  loadedAll: boolean;
  error?: string;
};

const getWorkspaceProvider = (workspace: NonNullable<Project['workspaces']>[number]) => {
  return workspace.providers?.find(p => p.provider_id === 'claude')
    ?? workspace.providers?.find(p => p.provider_id === 'codex')
    ?? workspace.providers?.[0];
};

const getSessionTitle = (session: ProviderSessionSummary): string => {
  const title = session.title || session.first_message;
  if (title?.trim()) return title.trim();
  return `${session.provider} session`;
};

const getProviderLabel = (provider: string): string => {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return provider;
};

const getProviderIcon = (provider: string) => {
  if (provider === 'claude') return ClaudeIcon;
  if (provider === 'codex') return OpenAIIcon;
  if (provider === 'gemini') return GeminiIcon;
  return MessageSquare;
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
  const { tabs, setActiveTab, removeTab, updateTab } = useTabContext();
  const { getInProgressTodos, getWorkspaceStatus, setWorkspaceStatus, markAsRead, clearWorkspace } = useWorkspaceTodo();
  const { closeWorkspace, isWorkspaceOpen, switchToWorkspace } = useContainerContext();
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
  // Local cache of workspace branch names (path -> branch name)
  const [workspaceBranches, setWorkspaceBranches] = useState<Record<string, string>>({});
  const [spaceSessions, setSpaceSessions] = useState<Record<string, SpaceSessionCache>>({});
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [renamingBranches, setRenamingBranches] = useState<Set<string>>(new Set());
  const [regeneratingSessionTitles, setRegeneratingSessionTitles] = useState<Set<string>>(new Set());

  const handleRegenerateSessionTitle = useCallback(async (spacePath: string, session: ProviderSessionSummary) => {
    const key = `${session.provider}:${session.id}`;
    if (!session.provider || !session.id || !session.project_id) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'error', message: 'Session is missing identifiers; cannot regenerate title' },
      }));
      return;
    }

    setRegeneratingSessionTitles(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const title = await generateSessionTitleForSessionViaEvent(session.provider, session.id, session.project_id);
      const cleaned = title?.trim();
      if (!cleaned) {
        throw new Error('Model returned an empty title');
      }
      setSpaceSessions(prev => {
        const cache = prev[spacePath];
        if (!cache) return prev;
        return {
          ...prev,
          [spacePath]: {
            ...cache,
            sessions: cache.sessions.map(s =>
              s.provider === session.provider && s.id === session.id
                ? { ...s, title: cleaned }
                : s
            ),
          },
        };
      });
      // Sync matching tab title
      const matchingTab = tabs.find(tab =>
        tab.type === 'chat' &&
        tab.sessionId === session.id &&
        (tab.providerId === session.provider || tab.sessionData?.provider === session.provider)
      );
      if (matchingTab) {
        updateTab(matchingTab.id, { title: cleaned });
      }
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'success', message: `Renamed session to "${cleaned}"` },
      }));
    } catch (err) {
      console.error('[ProjectList] Failed to regenerate session title:', err);
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'error', message: `Title regeneration failed: ${message}` },
      }));
    } finally {
      setRegeneratingSessionTitles(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [tabs, updateTab]);

  const handleRenameBranch = useCallback(async (workspacePath: string) => {
    setRenamingBranches(prev => {
      if (prev.has(workspacePath)) return prev;
      const next = new Set(prev);
      next.add(workspacePath);
      return next;
    });
    try {
      const proposed = await generateBranchNameViaEvent(workspacePath);
      const slug = proposed?.trim();
      if (!slug) {
        throw new Error('Model returned an empty branch name');
      }
      const renamed = await api.RenameGitBranch(workspacePath, slug);
      setWorkspaceBranches(prev => ({ ...prev, [workspacePath]: renamed }));
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'success', message: `Renamed branch to ${renamed}` },
      }));
    } catch (err) {
      console.error('[ProjectList] Failed to rename branch:', err);
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'error', message: `Branch rename failed: ${message}` },
      }));
    } finally {
      setRenamingBranches(prev => {
        if (!prev.has(workspacePath)) return prev;
        const next = new Set(prev);
        next.delete(workspacePath);
        return next;
      });
    }
  }, []);

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

  const sshProjectIds = useMemo(
    () => projects.filter(p => p.project_type === 'ssh').map(p => p.id),
    [projects]
  );
  const sshProjectIdsKey = sshProjectIds.join('|');

  // Check auto sync status for SSH projects
  useEffect(() => {
    const checkAutoSyncStatuses = async () => {
      const sshProjects = sshProjectIds;
      const statuses: Record<string, AutoSyncStatus> = {};

      for (const projectId of sshProjects) {
        try {
          const status = await api.getAutoSyncStatus(projectId);
          statuses[projectId] = status;
        } catch (err) {
          console.error('Failed to get auto sync status for', projectId, err);
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
  }, [sshProjectIdsKey]);

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
    (projects ?? []).forEach(project => {
      // Include project's own path for branch polling and running state
      if (project.path) {
        paths.push(project.path);
      }
      if (project.workspaces) {
        project.workspaces.forEach(ws => {
          // Find any AI provider (claude, codex, etc.)
          const aiProvider = ws.providers?.find(p =>
            p.provider_id === 'claude' || p.provider_id === 'codex' || p.provider_id === 'gemini'
          );
          if (aiProvider) {
            paths.push(aiProvider.path);
          }
        });
      }
    });
    return Array.from(new Set(paths)).sort();
  }, [projects]);
  const allWorkspacePathsKey = allWorkspacePaths.join('|');

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
  }, [allWorkspacePathsKey]);

  useEffect(() => {
    const loadRunningProviderSessions = async () => {
      try {
        const sessions = await api.listRunningProviderSessions() as main.LiveProviderSession[];
        const workspaceStates = new Map<string, boolean>();
        const sessionIds = new Set<string>();

        for (const session of sessions ?? []) {
          if (session.project_path) {
            workspaceStates.set(session.project_path, true);
          }
          if (session.provider && session.session_id) {
            sessionIds.add(`${session.provider}:${session.session_id}`);
          }
        }

        setRunningSessionIds(sessionIds);
        setWorkspaceRunningStates(prev => {
          const next = new Map(prev);
          allWorkspacePaths.forEach(path => next.set(path, workspaceStates.get(path) ?? false));
          workspaceStates.forEach((running, path) => next.set(path, running));
          return next;
        });
      } catch (err) {
        console.error('[ProjectList] Failed to list running provider sessions:', err);
      }
    };

    loadRunningProviderSessions();
    const interval = setInterval(loadRunningProviderSessions, 5000);
    return () => clearInterval(interval);
  }, [allWorkspacePathsKey]);

  // 临时注释：避免 process:changed → ListSpaceSessions 联动卡死 App
  // 每次后端 process:changed 事件都会触发 ListSpaceSessions RPC（同步扫描 JSONL），
  // 与 PTY/Claude 输出共用 256 容量的 WebSocket Send channel，导致按钮 RPC 响应排不进去。
  // running 状态仍由 listRunningProviderSessions 5 秒轮询维持。
  /*
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

    if (event.cwd) {
      setSpaceSessions(prev => {
        if (!prev[event.cwd]) return prev;
        const next = { ...prev };
        delete next[event.cwd];
        return next;
      });
      loadSpaceSessions(event.cwd, 10);
    }
  });
  */

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

  // Poll workspace branch names to detect git branch renames
  useEffect(() => {
    if (allWorkspacePaths.length === 0) return;

    const fetchBranches = async () => {
      const branches: Record<string, string> = {};
      await Promise.all(
        allWorkspacePaths.map(async (path) => {
          try {
            const branch = await api.getCurrentBranch(path);
            if (branch) {
              branches[path] = branch;
            }
          } catch {
            // Ignore errors for individual paths
          }
        })
      );
      setWorkspaceBranches(branches);
    };

    // Initial fetch
    fetchBranches();

    // Poll every 5 seconds
    const interval = setInterval(fetchBranches, 5000);
    return () => clearInterval(interval);
  }, [allWorkspacePathsKey]);

  // Determine how many projects to show
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [projects]
  );
  const workspacesByProjectId = useMemo(() => {
    const byProjectId = new Map<string, Project['workspaces']>();
    for (const project of projects) {
      if (!project.workspaces?.length) continue;
      byProjectId.set(
          project.id,
          [...project.workspaces]
          .sort((a, b) => b.added_at - a.added_at)
          .filter((workspace) => Boolean(getWorkspaceProvider(workspace)))
      );
    }
    return byProjectId;
  }, [projects]);

  const projectsPerPage = showAll ? 10 : 5;
  const totalPages = Math.ceil(sortedProjects.length / projectsPerPage);

  const handleViewAll = () => {
    setShowAll(true);
    setCurrentPage(1);
  };
  
  const handleViewLess = () => {
    setShowAll(false);
    setCurrentPage(1);
  };

  const loadSpaceSessions = async (spacePath: string, limit: number) => {
    if (!spacePath) return;
    setSpaceSessions(prev => ({
      ...prev,
      [spacePath]: {
        sessions: prev[spacePath]?.sessions ?? [],
        hasMore: prev[spacePath]?.hasMore ?? false,
        loadedAll: limit <= 0,
        loading: true,
      },
    }));

    try {
      const result = limit > 0
        ? await api.listSpaceSessions(spacePath, 10)
        : await api.listSpaceSessions(spacePath, 0);
      setSpaceSessions(prev => ({
        ...prev,
        [spacePath]: {
          sessions: result.sessions ?? [],
          hasMore: result.has_more ?? false,
          loadedAll: limit <= 0,
          loading: false,
        },
      }));
    } catch (error) {
      setSpaceSessions(prev => ({
        ...prev,
        [spacePath]: {
          sessions: prev[spacePath]?.sessions ?? [],
          hasMore: false,
          loadedAll: limit <= 0,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load sessions',
        },
      }));
    }
  };

  const ensureSpaceSessionsLoaded = (spacePath: string) => {
    if (!spacePath || spaceSessions[spacePath]) return;
    loadSpaceSessions(spacePath, 10);
  };

  useEffect(() => {
    const handleSpaceSessionsRefresh = (event: Event) => {
      const spacePath = (event as CustomEvent<{ spacePath?: string }>).detail?.spacePath;
      if (!spacePath) return;

      setSpaceSessions(prev => {
        if (!prev[spacePath]) return prev;
        setTimeout(() => {
          loadSpaceSessions(spacePath, prev[spacePath]?.loadedAll ? 0 : 10);
        }, 250);
        return prev;
      });
    };

    window.addEventListener('ropcode-space-sessions-refresh', handleSpaceSessionsRefresh);
    return () => window.removeEventListener('ropcode-space-sessions-refresh', handleSpaceSessionsRefresh);
  }, []);

  const openSessionTab = (spacePath: string, session: ProviderSessionSummary) => {
    const existingTab = tabs.find(tab =>
      tab.type === 'chat' &&
      tab.initialProjectPath === spacePath &&
      tab.sessionId === session.id &&
      tab.providerId === session.provider
    );
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }

    switchToWorkspace(spacePath);
    (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__ = { spacePath, session };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-provider-session', {
        detail: { spacePath, session },
      }));
    }, 0);
  };

  const openNewSessionTab = (spacePath: string) => {
    if (!spacePath) return;

    switchToWorkspace(spacePath);
    (window as any).__ROPCODE_PENDING_NEW_SESSION__ = { spacePath };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-new-session', {
        detail: { spacePath },
      }));
    }, 0);
  };

  const renderSpaceSessions = (spacePath: string, className = '') => {
    const cache = spaceSessions[spacePath];
    if (!cache) return null;

    return (
      <div className={cn("space-y-0.5", className)}>
        {cache.loading && cache.sessions.length === 0 && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading sessions...</div>
        )}
        {cache.error && (
          <div className="px-3 py-1.5 text-xs text-destructive truncate" title={cache.error}>
            Failed to load sessions
          </div>
        )}
        {cache.sessions.map((session) => {
          const ProviderIcon = getProviderIcon(session.provider);
          const isRunning = session.is_running || runningSessionIds.has(`${session.provider}:${session.id}`);
          const sessionKey = `${session.provider}:${session.id}`;
          const isRegenerating = regeneratingSessionTitles.has(sessionKey);

          return (
            <div
              key={sessionKey}
              className="group/session relative flex items-center text-xs text-muted-foreground hover:bg-accent/50 transition-colors rounded-md"
            >
              <button
                onClick={() => openSessionTab(spacePath, session)}
                className="min-w-0 flex-1 px-3 py-1.5 flex items-center gap-2 text-left hover:text-foreground"
                title={`${getProviderLabel(session.provider)} · ${getSessionTitle(session)}`}
              >
                <span className="relative flex-shrink-0 inline-flex h-4 w-4 items-center justify-center">
                  <ProviderIcon className="h-3.5 w-3.5" />
                  {isRunning && (
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 ring-1 ring-background" />
                  )}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", isRegenerating && "animate-title-generating")}>{isRegenerating ? "Generating..." : getSessionTitle(session)}</span>
                <span className="flex-shrink-0 text-[10px]">{formatTimeAgo(session.last_activity)}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRegenerating) return;
                  handleRegenerateSessionTitle(spacePath, session);
                }}
                disabled={isRegenerating}
                className={cn(
                  "flex-shrink-0 mr-1 p-1 rounded transition-all hover:bg-accent",
                  isRegenerating
                    ? "opacity-100 text-primary"
                    : "opacity-0 group-hover/session:opacity-100"
                )}
                title="Summarize current focus and rename this session"
                aria-label={`Rename session ${getSessionTitle(session)}`}
              >
                <Sparkles className={cn("h-3 w-3", isRegenerating && "animate-pulse text-primary")} />
              </button>
            </div>
          );
        })}
        {cache.hasMore && !cache.loadedAll && (
          <button
            onClick={() => loadSpaceSessions(spacePath, 0)}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors rounded-md"
          >
            <span className="ml-5">More</span>
          </button>
        )}
      </div>
    );
  };

  const toggleExpanded = (projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
        const project = projects.find(p => p.id === projectId);
        if (project?.path) {
          ensureSpaceSessionsLoaded(project.path);
        }
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

      // Close the workspace container first (this handles switching to another workspace/system)
      closeWorkspace(workspacePath);

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

      // Close all workspace containers under this project
      if (projectToDelete.workspaces) {
        projectToDelete.workspaces.forEach(ws => {
          const claudeProvider = ws.providers?.find(p => p.provider_id === 'claude');
          if (claudeProvider) {
            closeWorkspace(claudeProvider.path);
            clearWorkspace(claudeProvider.path);
          }
        });
      }

      // Find and close any tabs associated with this project and its workspaces
      const tabsToClose = tabs.filter(tab => {
        if (tab.initialProjectPath === projectToDelete.path) return true;
        // Also check if tab belongs to any workspace under this project
        if (projectToDelete.workspaces) {
          return projectToDelete.workspaces.some(ws => {
            const claudeProvider = ws.providers?.find(p => p.provider_id === 'claude');
            return claudeProvider && tab.initialProjectPath === claudeProvider.path;
          });
        }
        return false;
      });
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
              {sortedProjects.map((project) => {
                const isExpanded = expandedProjects.has(project.id);
                const projectWorkspaces = workspacesByProjectId.get(project.id) ?? [];
                const hasWorkspaces = projectWorkspaces.length > 0;
                const hasGitSupport = project.has_git_support ?? false;
                const canExpandProject = Boolean(project.path);

                // Check if project is directly active OR if any of its workspaces are active
                const isProjectDirectlyActive = activeProjectPath === project.path;
                const isProjectActiveViaWorkspace = hasWorkspaces && projectWorkspaces.some(ws => {
                  const provider = getWorkspaceProvider(ws);
                  return provider && activeProjectPath === provider.path;
                });
                const isProjectActive = isProjectDirectlyActive || isProjectActiveViaWorkspace;

                // Project's own running status
                const projectIsProcessRunning = workspaceRunningStates.get(project.path) ?? false;
                const projectContextStatus = getWorkspaceStatus(project.path);
                const projectInProgressTodos = getInProgressTodos(project.path);
                let projectStatus = projectContextStatus;
                if (projectIsProcessRunning && (projectContextStatus === 'idle' || projectContextStatus === 'unread')) {
                  projectStatus = 'working';
                }

                // Aggregate workspace statuses for line 2
                const workspaceAggStatuses = hasGitSupport ? projectWorkspaces.map(ws => {
                  const cp = getWorkspaceProvider(ws);
                  if (!cp) return 'idle';
                  const isRunning = workspaceRunningStates.get(cp.path) ?? false;
                  const ctxStatus = getWorkspaceStatus(cp.path);
                  if (isRunning && (ctxStatus === 'idle' || ctxStatus === 'unread')) return 'working';
                  return ctxStatus;
                }) : [];
                const wsWorkingCount = workspaceAggStatuses.filter(s => s === 'working' || s === 'active').length;
                const wsUnreadCount = workspaceAggStatuses.filter(s => s === 'unread').length;

                return (
                <div key={project.id} className="mb-0.5">
                  {/* Project Header */}
                  <div className={cn(
                    "group/project hover:bg-accent/50 transition-colors flex items-center rounded-md",
                    isProjectActive && "bg-accent border-l-2 border-primary"
                  )}>
                    <button
                      onClick={() => {
                        if (projectStatus === 'unread') {
                          markAsRead(project.path);
                        }
                        onProjectClick(project);
                      }}
                      className="flex-1 min-w-0 px-3 py-2 flex items-center gap-2 text-left"
                    >
                      {/* Project type icon - vertically centered across both lines */}
                      <span className="flex-shrink-0 inline-flex items-center justify-center">
                        {project.project_type === 'ssh' ? (
                          <Server className="h-5 w-5 text-muted-foreground" />
                        ) : project.project_type === 'git' ? (
                          <GitBranch className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        {/* Line 1: project name + workspace aggregate dots */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isProjectActive && (
                            <div className="flex-shrink-0 h-2 w-2 bg-blue-500 rounded-full border border-background" />
                          )}
                          <span className="font-medium text-sm truncate">{getProjectName(project.path)}</span>
                          {sshSyncMap[project.path] && (
                            <span className="flex-shrink-0 text-xs text-muted-foreground flex items-center gap-1">
                              {sshSyncMap[project.path].direction === 'upload' ? '↑' : '↓'}
                              <span>{sshSyncMap[project.path].percent}%</span>
                            </span>
                          )}
                          {hasGitSupport && hasWorkspaces && (
                            <span className="flex-shrink-0 flex items-center gap-1 text-xs">
                              {wsWorkingCount > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-purple-500 inline-block" />
                                  <span className="text-purple-500">{wsWorkingCount}</span>
                                </span>
                              )}
                              {wsUnreadCount > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 inline-block" />
                                  <span className="text-orange-500">{wsUnreadCount}</span>
                                </span>
                              )}
                              <span className="flex items-center gap-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground inline-block" />
                                <span className="text-muted-foreground">{projectWorkspaces.length}</span>
                              </span>
                            </span>
                          )}
                        </div>
                        {/* Line 2: status when active, branch name when idle (OR logic, same as workspace) */}
                        <div className="text-[10px] mt-0.5">
                          {projectStatus === 'working' ? (
                            <span className="text-purple-500">Working...</span>
                          ) : projectStatus === 'unread' ? (
                            <span className="text-orange-500 font-medium">Unread</span>
                          ) : projectStatus === 'active' && projectInProgressTodos[0] ? (
                            <span className="text-blue-500">{projectInProgressTodos[0].activeForm}</span>
                          ) : workspaceBranches[project.path] ? (
                            <span className="text-muted-foreground">{workspaceBranches[project.path]}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    {project.path && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openNewSessionTab(project.path);
                        }}
                        className="flex-shrink-0 transition-all p-1 rounded opacity-0 group-hover/project:opacity-100 hover:bg-accent"
                        title="New session"
                        aria-label={`New session in ${getProjectName(project.path)}`}
                      >
                        <MessageSquarePlus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
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
                    {/* Project tree expand button */}
                    {canExpandProject && (
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

                  {/* Project sessions and workspaces */}
                  {canExpandProject && isExpanded && (
                    <div className="overflow-hidden">
                        <div className="py-0.5 ml-2">
                          {renderSpaceSessions(project.path, "ml-2 mb-0.5")}

                          {hasGitSupport && (
                            <button
                              onClick={() => handleCreateWorkspace(project)}
                              className="w-full px-3 py-1.5 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors rounded-md mb-0.5"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>New workspace</span>
                            </button>
                          )}

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

                          {hasWorkspaces && projectWorkspaces.map((workspace) => {
                            const claudeProvider = getWorkspaceProvider(workspace);
                            if (!claudeProvider) return null;

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
                            <React.Fragment key={workspace.id}>
                            <div
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
                                    <Clock className="h-3.5 w-3.5 text-blue-500 mt-0.5" />
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
                                      {workspaceBranches[claudeProvider.path] || workspace.branch || workspace.name}
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
                                      <span className="text-purple-500 truncate">Working...</span>
                                    ) : workspaceStatus === 'unread' ? (
                                      <span className="text-orange-500 font-medium">Unread</span>
                                    ) : (
                                      <>{workspace.name}{workspace.name && ' · '}{formatTimeAgo(workspace.added_at)}</>
                                    )}
                                  </div>
                                </div>
                              </button>
                              {!isRemoving && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (renamingBranches.has(claudeProvider.path)) return;
                                    handleRenameBranch(claudeProvider.path);
                                  }}
                                  disabled={renamingBranches.has(claudeProvider.path)}
                                  className={cn(
                                    "flex-shrink-0 transition-all p-1 rounded hover:bg-accent",
                                    renamingBranches.has(claudeProvider.path)
                                      ? "opacity-100 text-primary"
                                      : "opacity-0 group-hover/workspace:opacity-100"
                                  )}
                                  title="Summarize current focus and rename this branch"
                                  aria-label={`Rename branch for ${workspaceBranches[claudeProvider.path] || workspace.branch || workspace.name}`}
                                >
                                  <Sparkles className={cn("h-3 w-3 text-muted-foreground", renamingBranches.has(claudeProvider.path) && "animate-pulse text-primary")} />
                                </button>
                              )}
                              {!isRemoving && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openNewSessionTab(claudeProvider.path);
                                  }}
                                  className="flex-shrink-0 transition-all p-1 rounded opacity-0 group-hover/workspace:opacity-100 hover:bg-accent"
                                  title="New session"
                                  aria-label={`New session in ${workspaceBranches[claudeProvider.path] || workspace.branch || workspace.name}`}
                                >
                                  <MessageSquarePlus className="h-3 w-3 text-muted-foreground" />
                                </button>
                              )}
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
                                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                                  ) : (
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  )}
                                </button>
                              )}
                            </div>
                            {renderSpaceSessions(claudeProvider.path, "ml-4")}
                            </React.Fragment>
                            );
                          })}
                        </div>
                    </div>
                  )}
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
