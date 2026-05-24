import React, { useState, useEffect } from 'react';
import { Minus, Square, X, ChevronRight, GitBranch, Upload, Folder, Trash2 } from 'lucide-react';
import { WindowMinimise, WindowToggleMaximise, Quit } from '@/lib/rpc-window';
import { motion } from 'framer-motion';
import { useFullscreen, usePageVisibilityPolling } from '@/hooks';
import { useIsMobile } from '@/hooks/useIsMobile';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ContainerTabManager } from '@/components/containers';
import { useContainerContext } from '@/contexts/ContainerContext';
import { InstanceSwitcher } from '@/components/InstanceSwitcher';
import { hasNativeWindowControls, fileManagerLabel } from '@/lib/platform';
import { basename } from '@/lib/pathUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const SIDEBAR_RAIL_WIDTH = 64;
const RIGHT_SIDEBAR_RAIL_WIDTH = 64;

interface CustomTitlebarProps {
  sidebarCollapsed?: boolean;
  sidebarWidth?: number; // Left sidebar pixel width
  rightSidebarOpen?: boolean;
  rightSidebarWidthPercent?: number; // Right sidebar width percentage
}

const OPEN_IN_LABELS: Record<string, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  pycharm: 'PyCharm',
  idea: 'IntelliJ IDEA',
  'android-studio': 'Android Studio',
  clion: 'CLion',
  webstorm: 'WebStorm',
  goland: 'GoLand',
  sublime: 'Sublime Text',
  iterm: 'iTerm',
  terminal: 'Terminal',
  cmd: 'Command Prompt',
  powershell: 'PowerShell',
  gitbash: 'Git Bash',
  wt: 'Windows Terminal',
};

function labelForApp(appType: string): string {
  if (appType === 'filemanager') return fileManagerLabel();
  return OPEN_IN_LABELS[appType] ?? appType;
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  sidebarCollapsed = false,
  sidebarWidth = 360,
  rightSidebarOpen: rightSidebarOpenProp = true,
  rightSidebarWidthPercent = 35
}) => {
  // Get current workspace path from ContainerContext
  const { activeType, activeWorkspaceId } = useContainerContext();
  const currentProjectPath = activeType === 'workspace' ? activeWorkspaceId : undefined;

  const isMobile = useIsMobile();

  const [isHovered, setIsHovered] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(rightSidebarOpenProp);
  // Actual right sidebar visibility (considering tab type and all conditions)
  const [shouldShowRightSidebar, setShouldShowRightSidebar] = useState(rightSidebarOpenProp);
  // Right sidebar width percentage
  const [currentWidthPercent, setCurrentWidthPercent] = useState(rightSidebarWidthPercent);
  const [rightSidebarRailWidth, setRightSidebarRailWidth] = useState(RIGHT_SIDEBAR_RAIL_WIDTH);
  const { toggleFullscreen, isSupported, isFullscreen } = useFullscreen();

  // Double-click titlebar to maximize
  const handleDoubleClick = (e: React.MouseEvent) => {
    // Ensure not double-clicking on buttons or interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('.window-no-drag') || target.closest('button')) {
      return;
    }
    // Use native fullscreen on macOS, maximize on other platforms
    if (isSupported) {
      toggleFullscreen();
    } else {
      WindowToggleMaximise();
    }
  };

  // Worktree state
  const [unpushedCount, setUnpushedCount] = useState<number>(0);
  const [isPushing, setIsPushing] = useState(false);
  const [isWorktreeChild, setIsWorktreeChild] = useState(false);

  // Push to remote state
  const [unpushedToRemoteCount, setUnpushedToRemoteCount] = useState<number>(0);
  const [isPushingToRemote, setIsPushingToRemote] = useState(false);

  // Workspace cleanup state
  const [isCleaning, setIsCleaning] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  // Open-in apps menu (resolved from backend on mount, platform-specific)
  const [openInApps, setOpenInApps] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listOpenInApps()
      .then((apps: string[]) => {
        if (!cancelled) setOpenInApps(apps);
      })
      .catch((err: unknown) => {
        console.error('[CustomTitlebar] Failed to list open-in apps:', err);
      });
    return () => { cancelled = true; };
  }, []);

  // Git support state
  const [hasGitSupport, setHasGitSupport] = useState(false);

  // Workspace and branch info
  const [workspaceInfo, setWorkspaceInfo] = useState<{
    workspaceName: string;
    branchName: string;
  } | null>(null);

  // Sync external right sidebar state
  useEffect(() => {
    setRightSidebarOpen(rightSidebarOpenProp);
  }, [rightSidebarOpenProp]);

  // Listen for right sidebar state changes (including actual visibility)
  useEffect(() => {
    const handleStateChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ isOpen: boolean; shouldShow: boolean; railWidth?: number; workspacePath?: string }>;
      if (customEvent.detail.workspacePath && customEvent.detail.workspacePath !== currentProjectPath) return;
      setRightSidebarOpen(customEvent.detail.isOpen);
      setShouldShowRightSidebar(customEvent.detail.shouldShow);
      setRightSidebarRailWidth(customEvent.detail.railWidth ?? RIGHT_SIDEBAR_RAIL_WIDTH);
    };

    window.addEventListener('right-sidebar-state-changed', handleStateChange);
    return () => {
      window.removeEventListener('right-sidebar-state-changed', handleStateChange);
    };
  }, [currentProjectPath]);

  // Sync external right sidebar width percentage
  useEffect(() => {
    setCurrentWidthPercent(rightSidebarWidthPercent);
  }, [rightSidebarWidthPercent]);

  // Listen for right sidebar width percentage changes
  useEffect(() => {
    const handleWidthChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ widthPercent: number; railWidth?: number; isOpen?: boolean; workspacePath?: string }>;
      if (customEvent.detail.workspacePath && customEvent.detail.workspacePath !== currentProjectPath) return;
      setCurrentWidthPercent(customEvent.detail.widthPercent);
      setRightSidebarRailWidth(customEvent.detail.railWidth ?? RIGHT_SIDEBAR_RAIL_WIDTH);
      if (typeof customEvent.detail.isOpen === 'boolean') {
        setRightSidebarOpen(customEvent.detail.isOpen);
      }
    };

    window.addEventListener('right-sidebar-width-changed', handleWidthChange);
    return () => {
      window.removeEventListener('right-sidebar-width-changed', handleWidthChange);
    };
  }, [currentProjectPath]);

  // Detect Git support
  useEffect(() => {
    if (!currentProjectPath) {
      setHasGitSupport(false);
      return;
    }

    const checkGitSupport = async () => {
      try {
        const isGitRepo = await api.isGitRepository(currentProjectPath);
        setHasGitSupport(isGitRepo);
      } catch (error) {
        console.error('Failed to check git support:', error);
        setHasGitSupport(false);
      }
    };

    checkGitSupport();
  }, [currentProjectPath]);

  // Get workspace and branch info
  useEffect(() => {
    if (!currentProjectPath || !hasGitSupport) {
      setWorkspaceInfo(null);
      return;
    }

    const updateWorkspaceInfo = async () => {
      try {
        // Get current branch
        const branchName = await api.getCurrentBranch(currentProjectPath);

        // Get workspace name from project path
        const workspaceName = basename(currentProjectPath, 'Unknown');

        setWorkspaceInfo({
          workspaceName,
          branchName
        });
      } catch (error) {
        // Silently ignore git errors for non-git directories
        // Still set workspace name even if branch fetch fails
        const workspaceName = basename(currentProjectPath, 'Unknown');
        setWorkspaceInfo({
          workspaceName,
          branchName: 'main' // fallback
        });
      }
    };

    updateWorkspaceInfo();
  }, [currentProjectPath, hasGitSupport]);

  // Detect if worktree child branch (init)
  useEffect(() => {
    if (!currentProjectPath || !hasGitSupport) {
      setIsWorktreeChild(false);
      setUnpushedCount(0);
      return;
    }

    const checkWorktree = async () => {
      try {
        const worktreeInfo = await api.detectWorktree(currentProjectPath);
        setIsWorktreeChild(worktreeInfo.is_worktree);

        if (worktreeInfo.is_worktree) {
          const count = await api.getUnpushedCommitsCount(currentProjectPath);
          setUnpushedCount(count);
        } else {
          setUnpushedCount(0);
        }
      } catch (error) {
        console.error('Failed to check worktree status:', error);
        setIsWorktreeChild(false);
        setUnpushedCount(0);
      }
    };

    checkWorktree();
  }, [currentProjectPath, hasGitSupport]);

  // Detect unpushed-to-remote commit count (init)
  useEffect(() => {
    if (!currentProjectPath || !hasGitSupport) {
      setUnpushedToRemoteCount(0);
      return;
    }

    const checkUnpushedToRemote = async () => {
      try {
        const count = await api.getUnpushedToRemoteCount(currentProjectPath);
        setUnpushedToRemoteCount(count);
      } catch (error) {
        // Silently handle error, may not be a git repo
        setUnpushedToRemoteCount(0);
      }
    };

    checkUnpushedToRemote();
  }, [currentProjectPath, hasGitSupport]);

  // Page visibility polling - periodically check unpushed commit count
  // Only poll when page is active, to catch changes from external git operations
  usePageVisibilityPolling(
    async () => {
      if (!currentProjectPath || !hasGitSupport) return;

      try {
        // Update unpushed-to-remote commit count
        const unpushedToRemote = await api.getUnpushedToRemoteCount(currentProjectPath);
        setUnpushedToRemoteCount(unpushedToRemote);

        // If worktree child branch, also update worktree data
        if (isWorktreeChild) {
          const unpushedToMain = await api.getUnpushedCommitsCount(currentProjectPath);
          setUnpushedCount(unpushedToMain);
        }
      } catch (error) {
        // Silently handle error to avoid frequent error messages
        console.error('[CustomTitlebar] Polling git status error:', error);
      }
    },
    {
      interval: 3000, // Poll every 3 seconds
      enabled: !!currentProjectPath && hasGitSupport,
      immediate: true,
    }
  );

  if (isMobile) return null;

  // Push to main branch
  const handlePushToMain = async () => {
    if (!currentProjectPath || isPushing) return;

    setIsPushing(true);
    try {
      const result = await api.pushToMainWorktree(currentProjectPath);
      console.log('Push successful:', result);

      // Re-check commit count after successful push
      const count = await api.getUnpushedCommitsCount(currentProjectPath);
      setUnpushedCount(count);

      // Show success toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Successfully merged to main branch',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to push to main worktree:', error);

      // Better error handling
      const errorMessage = String(error);
      let message = '';

      if (errorMessage.includes('uncommitted changes')) {
        message = 'Main worktree has uncommitted changes. Please commit or stash them first.';
      } else if (errorMessage.includes('conflict')) {
        message = 'Merge would result in conflicts. Please resolve manually in the main worktree directory.';
      } else {
        message = `Push failed: ${errorMessage}`;
      }

      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message,
          type: 'error'
        }
      }));
    } finally {
      setIsPushing(false);
    }
  };

  // Push to remote
  const handlePushToRemote = async () => {
    if (!currentProjectPath || isPushingToRemote) return;

    setIsPushingToRemote(true);
    try {
      const result = await api.pushToRemote(currentProjectPath);
      console.log('Push to remote successful:', result);

      // Re-check commit count after successful push
      const count = await api.getUnpushedToRemoteCount(currentProjectPath);
      setUnpushedToRemoteCount(count);

      // Show success toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Successfully pushed to remote',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to push to remote:', error);

      // Better error handling
      const errorMessage = String(error);
      let message = '';

      if (errorMessage.includes('uncommitted changes')) {
        message = 'There are uncommitted changes. Please commit or stash them first.';
      } else if (errorMessage.includes('rejected')) {
        message = 'Push rejected. Please pull the latest changes first.';
      } else if (errorMessage.includes('No remote')) {
        message = 'No remote repository configured.';
      } else {
        message = `Push failed: ${errorMessage}`;
      }

      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message,
          type: 'error'
        }
      }));
    } finally {
      setIsPushingToRemote(false);
    }
  };

  // Clean up workspace
  const handleCleanupWorkspace = async () => {
    if (!currentProjectPath || isCleaning) return;

    setIsCleaning(true);
    setShowCleanupDialog(false);
    try {
      const result = await api.cleanupWorkspace(currentProjectPath);
      console.log('Workspace cleanup successful:', result);

      // Re-check status after successful cleanup
      if (isWorktreeChild) {
        const count = await api.getUnpushedCommitsCount(currentProjectPath);
        setUnpushedCount(count);
      } else {
        const count = await api.getUnpushedToRemoteCount(currentProjectPath);
        setUnpushedToRemoteCount(count);
      }

      // Show success toast
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Workspace cleaned successfully',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to cleanup workspace:', error);

      // Better error handling
      const errorMessage = String(error);
      let message = '';

      if (errorMessage.includes('not a git repository')) {
        message = 'This directory is not a git repository.';
      } else if (errorMessage.includes('Failed to reset changes')) {
        message = 'Failed to reset uncommitted changes. Please check file permissions.';
      } else if (errorMessage.includes('Failed to clean untracked files')) {
        message = 'Failed to remove untracked files. Please check file permissions.';
      } else {
        message = `Cleanup failed: ${errorMessage}`;
      }

      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message,
          type: 'error'
        }
      }));
    } finally {
      setIsCleaning(false);
    }
  };

  // Handle cleanup button click
  const handleCleanupClick = () => {
    setShowCleanupDialog(true);
  };

  // Handle cleanup cancel
  const handleCleanupCancel = () => {
    setShowCleanupDialog(false);
  };

  const handleMinimize = async () => {
    try {
      WindowMinimise();
      console.log('Window minimized successfully');
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  const handleMaximize = async () => {
    try {
      // Use native fullscreen on macOS, maximize on other platforms
      if (isSupported) {
        console.log('Toggling native fullscreen (macOS)');
        await toggleFullscreen();
      } else {
        WindowToggleMaximise();
        console.log('Window maximize toggled successfully');
      }
    } catch (error) {
      console.error('Failed to maximize/fullscreen window:', error);
    }
  };

  const handleClose = async () => {
    try {
      Quit();
      console.log('Window closed successfully');
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  const handleToggleRightSidebar = () => {
    // Dispatch global event to toggle right sidebar
    window.dispatchEvent(new CustomEvent('toggle-right-sidebar'));
  };

  const handleOpenInApp = async (appType: string) => {
    console.log('[CustomTitlebar] handleOpenInApp called with:', { appType, currentProjectPath });

    if (!currentProjectPath) {
      console.warn('[CustomTitlebar] No project path available');
      return;
    }

    try {
      console.log(`[CustomTitlebar] Calling api.openInExternalApp(${appType}, ${currentProjectPath})`);
      await api.openInExternalApp(appType, currentProjectPath);
      console.log(`[CustomTitlebar] ✅ Successfully opened ${appType} with path: ${currentProjectPath}`);
    } catch (error) {
      console.error(`[CustomTitlebar] ❌ Failed to open in ${appType}:`, error);
    }
  };

  return (
    <div
      className="relative z-[200] h-11 bg-background/95 backdrop-blur-sm flex items-stretch select-none window-drag border-b border-border/50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Left area - corresponds to left sidebar */}
      <motion.div
        initial={false}
        animate={{
          width: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth
        }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="flex items-center border-r border-border/50 window-drag min-w-16"
        style={{ flexShrink: 0 }}
      >
        {/* Traffic light buttons: Electron only provides native controls on selected platforms. */}
        {!isFullscreen && !hasNativeWindowControls() && (
          <div className="flex items-center space-x-2 pl-5">
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="group relative w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-all duration-200 flex items-center justify-center window-no-drag"
              title="Close"
            >
              {isHovered && (
                <X size={8} className="text-red-900 opacity-60 group-hover:opacity-100" />
              )}
            </button>

            {/* Minimize button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMinimize();
              }}
              className="group relative w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-all duration-200 flex items-center justify-center window-no-drag"
              title="Minimize"
            >
              {isHovered && (
                <Minus size={8} className="text-yellow-900 opacity-60 group-hover:opacity-100" />
              )}
            </button>

            {/* Maximize/Fullscreen button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMaximize();
              }}
              className="group relative w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-all duration-200 flex items-center justify-center window-no-drag"
              title={isSupported ? "Fullscreen" : "Maximize"}
            >
              {isHovered && (
                <Square size={6} className="text-green-900 opacity-60 group-hover:opacity-100" />
              )}
            </button>
          </div>
        )}
      </motion.div>

      {/* Middle area - TabManager + Titlebar Controls */}
      <div className="flex-1 flex items-stretch gap-2 px-2 window-drag min-w-0">
        {/* ContainerTabManager - shows TabManager based on activeType */}
        <ContainerTabManager className="self-stretch" />

        {/* Right side - Port + Workspace Name and Open in button */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* Instance Switcher (port indicator + dropdown) */}
          {typeof window !== 'undefined' && (window.location.port || (window as any).electronAPI?.wsPort || (window as any).__ROPCODE_WS_PORT__) && (
            <InstanceSwitcher />
          )}
          {/* Workspace Name - shown left of Open in button, click to open file manager */}
          {workspaceInfo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInApp('filemanager');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-[11px] text-foreground transition-colors window-no-drag cursor-pointer"
              title={`Click to open in ${fileManagerLabel()}`}
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="font-medium">/{workspaceInfo.workspaceName}</span>
            </button>
          )}

          {/* Open in External App button */}
          {currentProjectPath && openInApps.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors window-no-drag flex items-center gap-1.5"
                  title="Open in External Application"
                >
                  <span className="text-xs font-medium">Open in</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 window-no-drag">
                {openInApps.map((appType) => (
                  <DropdownMenuItem key={appType} onClick={() => handleOpenInApp(appType)}>
                    <span className="text-sm">{labelForApp(appType)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

        </div>
      </div>

      {/* Right area - corresponds to right sidebar */}
      <div
        className={`transition-none flex items-center justify-end window-drag overflow-hidden ${shouldShowRightSidebar ? 'border-l border-border/50' : ''}`}
        style={{
          width: shouldShowRightSidebar
            ? rightSidebarOpen
              ? `calc((100% - ${sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth}px) * ${currentWidthPercent / 100} + ${rightSidebarRailWidth}px)`
              : rightSidebarRailWidth
            : 0,
          flexShrink: 0
        }}
      >
        {/* Worktree push buttons - only shown for worktree child branches with Git support */}
        {hasGitSupport && isWorktreeChild && shouldShowRightSidebar && rightSidebarOpen && (
          <div className="flex items-center gap-2 px-3">
            {/* Unpushed commit count indicator - always visible */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary">
              <GitBranch className="h-3 w-3" />
              <span className="text-xs font-medium">{unpushedCount}</span>
            </div>

            {/* Push to main branch button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handlePushToMain();
              }}
              disabled={isPushing || unpushedCount === 0}
              className="h-7 px-2 gap-1 window-no-drag"
              title={`Push ${unpushedCount} commit(s) to main branch`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {isPushing ? 'Pushing...' : 'Push'}
              </span>
            </Button>
          </div>
        )}

        {/* Project push-to-remote buttons - only shown for non-worktree branches with Git support */}
        {hasGitSupport && !isWorktreeChild && shouldShowRightSidebar && rightSidebarOpen && (
          <div className="flex items-center gap-2 px-3">
            {/* Unpushed-to-remote commit count indicator - always visible */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary">
              <GitBranch className="h-3 w-3" />
              <span className="text-xs font-medium">{unpushedToRemoteCount}</span>
            </div>

            {/* Push to remote button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handlePushToRemote();
              }}
              disabled={isPushingToRemote || unpushedToRemoteCount === 0}
              className="h-7 px-2 gap-1 window-no-drag"
              title={`Push ${unpushedToRemoteCount} commit(s) to remote`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                {isPushingToRemote ? 'Pushing...' : 'Push'}
              </span>
            </Button>
          </div>
        )}

        {/* Workspace cleanup button - only shown when right sidebar is visible and Git is supported */}
        {hasGitSupport && shouldShowRightSidebar && rightSidebarOpen && (
          <div className="flex items-center gap-2 px-3 border-l pl-4 ml-2">
            <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isCleaning}
                  onClick={handleCleanupClick}
                  className="h-7 px-2 gap-1 window-no-drag text-red-600 hover:text-red-700 hover:bg-red-50"
                  title="Clean up workspace (reset all changes, remove untracked files, and reset to remote)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">
                    {isCleaning ? 'Cleaning...' : 'Clean'}
                  </span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clean Up Workspace</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action will perform the following irreversible operations:
                    <br /><br />
                    • Reset all uncommitted changes (staged and unstaged)
                    <br />
                    • Remove all untracked files and directories
                    <br />
                    • Reset to match the remote branch
                    <br /><br />
                    <strong>Warning: This operation cannot be undone!</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={handleCleanupCancel}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      handleCleanupWorkspace();
                    }}
                    disabled={isCleaning}
                  >
                    {isCleaning ? 'Cleaning...' : 'Clean Up'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
};
