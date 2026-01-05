import React, { useState, useEffect } from 'react';
import { Minus, Square, X, ChevronRight, GitBranch, Upload, Folder, Trash2 } from 'lucide-react';
import { WindowMinimise, WindowToggleMaximise, Quit } from '@/lib/rpc-window';
import { motion } from 'framer-motion';
import { useFullscreen, usePageVisibilityPolling } from '@/hooks';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ContainerTabManager } from '@/components/containers';
import { useContainerContext } from '@/contexts/ContainerContext';
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

interface CustomTitlebarProps {
  sidebarCollapsed?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidthPercent?: number; // 右侧栏宽度百分比
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  sidebarCollapsed = false,
  rightSidebarOpen: rightSidebarOpenProp = true,
  rightSidebarWidthPercent = 35
}) => {
  // 从 ContainerContext 获取当前 workspace 路径
  const { activeType, activeWorkspaceId } = useContainerContext();
  const currentProjectPath = activeType === 'workspace' ? activeWorkspaceId : undefined;

  // 检测是否在 Electron 环境中运行（Electron 有原生的 macOS 窗口按钮）
  const isElectron = !!window.electronAPI;

  const [isHovered, setIsHovered] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(rightSidebarOpenProp);
  // 真实的右侧栏显示状态（考虑了 tab 类型等所有条件）
  const [shouldShowRightSidebar, setShouldShowRightSidebar] = useState(rightSidebarOpenProp);
  // 右侧栏宽度百分比
  const [currentWidthPercent, setCurrentWidthPercent] = useState(rightSidebarWidthPercent);
  const { toggleFullscreen, isSupported, isFullscreen } = useFullscreen();

  // 双击标题栏最大化处理
  const handleDoubleClick = (e: React.MouseEvent) => {
    // 确保不是在按钮或其他交互元素上双击
    const target = e.target as HTMLElement;
    if (target.closest('.window-no-drag') || target.closest('button')) {
      return;
    }
    // 在 macOS 上使用原生全屏，其他平台使用最大化
    if (isSupported) {
      toggleFullscreen();
    } else {
      WindowToggleMaximise();
    }
  };

  // Worktree 状态
  const [unpushedCount, setUnpushedCount] = useState<number>(0);
  const [isPushing, setIsPushing] = useState(false);
  const [isWorktreeChild, setIsWorktreeChild] = useState(false);

  // Project 推送到远程状态
  const [unpushedToRemoteCount, setUnpushedToRemoteCount] = useState<number>(0);
  const [isPushingToRemote, setIsPushingToRemote] = useState(false);

  // 工作空间清理状态
  const [isCleaning, setIsCleaning] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  // Git 支持状态
  const [hasGitSupport, setHasGitSupport] = useState(false);

  // 工作区和分支信息
  const [workspaceInfo, setWorkspaceInfo] = useState<{
    workspaceName: string;
    branchName: string;
  } | null>(null);

  // 同步外部传入的右侧栏状态
  useEffect(() => {
    setRightSidebarOpen(rightSidebarOpenProp);
  }, [rightSidebarOpenProp]);

  // 监听右侧栏状态变化（包括真实显示状态）
  useEffect(() => {
    const handleStateChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ isOpen: boolean; shouldShow: boolean }>;
      setRightSidebarOpen(customEvent.detail.isOpen);
      setShouldShowRightSidebar(customEvent.detail.shouldShow);
    };

    window.addEventListener('right-sidebar-state-changed', handleStateChange);
    return () => {
      window.removeEventListener('right-sidebar-state-changed', handleStateChange);
    };
  }, []);

  // 同步外部传入的右侧栏宽度百分比
  useEffect(() => {
    setCurrentWidthPercent(rightSidebarWidthPercent);
  }, [rightSidebarWidthPercent]);

  // 监听右侧栏宽度百分比变化
  useEffect(() => {
    const handleWidthChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ widthPercent: number }>;
      setCurrentWidthPercent(customEvent.detail.widthPercent);
    };

    window.addEventListener('right-sidebar-width-changed', handleWidthChange);
    return () => {
      window.removeEventListener('right-sidebar-width-changed', handleWidthChange);
    };
  }, []);

  // 检测 Git 支持
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

  // 获取工作区和分支信息
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
        const workspaceName = currentProjectPath.split('/').pop() || currentProjectPath.split('\\').pop() || 'Unknown';

        setWorkspaceInfo({
          workspaceName,
          branchName
        });
      } catch (error) {
        console.error('[CustomTitlebar] Failed to get workspace info:', error);
        // Still set workspace name even if branch fetch fails
        const workspaceName = currentProjectPath.split('/').pop() || currentProjectPath.split('\\').pop() || 'Unknown';
        setWorkspaceInfo({
          workspaceName,
          branchName: 'main' // fallback
        });
      }
    };

    updateWorkspaceInfo();
  }, [currentProjectPath, hasGitSupport]);

  // 检测是否为 worktree 子分支（初始化）
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

  // 检测未推送到远程的提交数（初始化）
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
        // 静默处理错误，可能不是 git 仓库
        setUnpushedToRemoteCount(0);
      }
    };

    checkUnpushedToRemote();
  }, [currentProjectPath, hasGitSupport]);

  // 页面可见性轮询 - 定期检查未推送的提交数量
  // 只在页面激活时轮询，用于捕获外部 git 操作导致的变化
  usePageVisibilityPolling(
    async () => {
      if (!currentProjectPath || !hasGitSupport) return;

      try {
        // 更新未推送到远程的提交数
        const unpushedToRemote = await api.getUnpushedToRemoteCount(currentProjectPath);
        setUnpushedToRemoteCount(unpushedToRemote);

        // 如果是 worktree 子分支，同时更新 worktree 相关数据
        if (isWorktreeChild) {
          const unpushedToMain = await api.getUnpushedCommitsCount(currentProjectPath);
          setUnpushedCount(unpushedToMain);
        }
      } catch (error) {
        // 静默处理错误，避免频繁的错误提示
        console.error('[CustomTitlebar] Polling git status error:', error);
      }
    },
    {
      interval: 3000, // 每 3 秒轮询一次
      enabled: !!currentProjectPath && hasGitSupport,
      immediate: true,
    }
  );

  // 推送到主分支
  const handlePushToMain = async () => {
    if (!currentProjectPath || isPushing) return;

    setIsPushing(true);
    try {
      const result = await api.pushToMainWorktree(currentProjectPath);
      console.log('Push successful:', result);

      // 推送成功后重新检查提交数
      const count = await api.getUnpushedCommitsCount(currentProjectPath);
      setUnpushedCount(count);

      // 显示成功提示
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Successfully merged to main branch',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to push to main worktree:', error);

      // 更友好的错误处理
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

  // 推送到远程
  const handlePushToRemote = async () => {
    if (!currentProjectPath || isPushingToRemote) return;

    setIsPushingToRemote(true);
    try {
      const result = await api.pushToRemote(currentProjectPath);
      console.log('Push to remote successful:', result);

      // 推送成功后重新检查提交数
      const count = await api.getUnpushedToRemoteCount(currentProjectPath);
      setUnpushedToRemoteCount(count);

      // 显示成功提示
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Successfully pushed to remote',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to push to remote:', error);

      // 更友好的错误处理
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

  // 清理工作空间
  const handleCleanupWorkspace = async () => {
    if (!currentProjectPath || isCleaning) return;

    setIsCleaning(true);
    setShowCleanupDialog(false);
    try {
      const result = await api.cleanupWorkspace(currentProjectPath);
      console.log('Workspace cleanup successful:', result);

      // 清理成功后重新检查状态
      if (isWorktreeChild) {
        const count = await api.getUnpushedCommitsCount(currentProjectPath);
        setUnpushedCount(count);
      } else {
        const count = await api.getUnpushedToRemoteCount(currentProjectPath);
        setUnpushedToRemoteCount(count);
      }

      // ���示成功提示
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: {
          message: 'Workspace cleaned successfully',
          type: 'success'
        }
      }));
    } catch (error) {
      console.error('Failed to cleanup workspace:', error);

      // 更友好的错误处理
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

  // 处理清理按钮点击
  const handleCleanupClick = () => {
    setShowCleanupDialog(true);
  };

  // 处理取消清理
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
      // 在 macOS 上使用原生全屏，其他平台使用最大化
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
    // 触发全局事件来切换右侧栏
    window.dispatchEvent(new CustomEvent('toggle-right-sidebar'));
  };

  const handleOpenInApp = async (appType: "pycharm" | "idea" | "clion" | "android-studio" | "iterm" | "finder" | "sublime") => {
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
      {/* 左侧区域 - 对应左侧边栏 (20% / 3%) */}
      <motion.div
        initial={false}
        animate={{
          width: sidebarCollapsed ? '3%' : '20%'
        }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="flex items-center border-r border-border/50 window-drag min-w-[48px]"
        style={{ flexShrink: 0 }}
      >
        {/* macOS Traffic Light buttons (hidden in fullscreen and in Electron which has native buttons) */}
        {!isFullscreen && !isElectron && (
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

      {/* 中间区域 - TabManager + Titlebar Controls */}
      <div className="flex-1 flex items-stretch gap-2 px-2 window-drag min-w-0">
        {/* ContainerTabManager - 根据 activeType 显示对应的 TabManager */}
        <ContainerTabManager className="self-stretch" />

        {/* 右侧 - Workspace Name 和 Open in 按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {/* Workspace Name - 显示在 Open in 按钮左侧，点击打开 Finder */}
          {workspaceInfo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInApp('finder');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent/30 hover:bg-accent/50 text-[11px] text-foreground transition-colors window-no-drag cursor-pointer"
              title="Click to open in Finder"
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="font-medium">/{workspaceInfo.workspaceName}</span>
            </button>
          )}

          {/* Open in External App button */}
          {currentProjectPath && (
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
                <DropdownMenuItem onClick={() => handleOpenInApp('finder')}>
                  <span className="text-sm">Finder</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('pycharm')}>
                  <span className="text-sm">PyCharm</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('idea')}>
                  <span className="text-sm">IntelliJ IDEA</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('android-studio')}>
                  <span className="text-sm">Android Studio</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('clion')}>
                  <span className="text-sm">CLion</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('iterm')}>
                  <span className="text-sm">iTerm</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenInApp('sublime')}>
                  <span className="text-sm">Sublime Text</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

        </div>
      </div>

      {/* 右侧区域 - 对应右侧边栏 */}
      <div
        className={`transition-none flex items-center justify-end window-drag overflow-hidden ${shouldShowRightSidebar ? 'border-l border-border/50' : ''}`}
        style={{
          // 计算相对于整个标题栏的百分比
          // 下方: WorkspaceContainer宽度 = (100% - Sidebar%)
          // RightSidebar占WorkspaceContainer的35%
          // 所以实际占窗口: (100% - Sidebar%) × 35%
          // 标题栏右侧应该占: (100% - Sidebar%) × (currentWidthPercent / 100)
          width: shouldShowRightSidebar
            ? `${(100 - (sidebarCollapsed ? 3 : 20)) * currentWidthPercent / 100}%`
            : 0,
          flexShrink: 0
        }}
      >
        {/* Worktree 推送按钮组 - 只在是 worktree 子分支且有 Git 支持时显示 */}
        {hasGitSupport && isWorktreeChild && shouldShowRightSidebar && (
          <div className="flex items-center gap-2 px-3">
            {/* 未推送提交数量指示器 - 始终显示 */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary">
              <GitBranch className="h-3 w-3" />
              <span className="text-xs font-medium">{unpushedCount}</span>
            </div>

            {/* 推送到主分支按钮 */}
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

        {/* Project 推送到远程按钮组 - 只在非 worktree 子分支且有 Git 支持时显示 */}
        {hasGitSupport && !isWorktreeChild && shouldShowRightSidebar && (
          <div className="flex items-center gap-2 px-3">
            {/* 未推送到远程的提交数量指示器 - 始终显示 */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary">
              <GitBranch className="h-3 w-3" />
              <span className="text-xs font-medium">{unpushedToRemoteCount}</span>
            </div>

            {/* 推送到远程按钮 */}
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

        {/* 工作空间清理按钮 - 只在右侧栏真正显示且有 Git 支持时显示 */}
        {hasGitSupport && shouldShowRightSidebar && (
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
