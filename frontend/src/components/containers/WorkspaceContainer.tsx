import React, { Suspense, lazy, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceTabProvider, useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import { RightSidebar } from '@/components/right-sidebar';
import { Loader2 } from 'lucide-react';
import { providers } from '@/lib/providers';
import { WorkspaceTabManager } from './WorkspaceTabManager';

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer').then(m => ({ default: m.AgentRunOutputViewer })));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewWidget = lazy(() => import('@/components/WebViewWidget').then(m => ({ default: m.WebViewWidget })));

interface WorkspaceContainerProps {
  workspaceId: string;
  visible: boolean;
}

const WorkspaceContent: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const { tabs, activeTabId, addTab, updateTab, removeTab, getTabById } = useWorkspaceTabContext();
  const activeTabIdRef = React.useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Track initialization to prevent double-init in StrictMode
  const initializingRef = React.useRef(false);
  const initializedRef = React.useRef(false);
  const tabIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    // Prevent double initialization
    if (initializedRef.current || initializingRef.current) {
      return;
    }
    if (tabs.length === 0) {
      initializingRef.current = true;
      initializeWorkspace().finally(() => {
        initializingRef.current = false;
        initializedRef.current = true;
      });
    } else {
      // Already has tabs, mark as initialized
      initializedRef.current = true;
    }
  }, []);

  const initializeWorkspace = async () => {
    // Step 1: Immediately add an empty chat tab (non-blocking)
    // This allows the UI to render immediately without waiting for session list
    const newTabId = addTab({
      type: 'chat',
      title: 'Chat',
      sessionId: undefined,
      sessionData: undefined,
      projectPath: workspaceId,
      providerId: 'claude',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'message-square',
    });
    tabIdRef.current = newTabId;

    // Step 2: Load sessions in the background (non-blocking)
    // Use setTimeout to yield to the browser and allow initial render
    setTimeout(async () => {
      try {
        const sessionList = await providers.listSessions(workspaceId, 'claude');
        if (sessionList.length > 0) {
          const sortedSessions = [...sessionList].sort((a, b) => {
            const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
            const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
            return timeB - timeA;
          });
          const selectedSession = sortedSessions[0];

          // Update the tab with session data
          if (tabIdRef.current) {
            updateTab(tabIdRef.current, {
              sessionId: selectedSession.id,
              sessionData: { ...selectedSession, provider: 'claude' },
            });
          }
        }
      } catch (err) {
        console.error('[WorkspaceContainer] Failed to load sessions in background:', err);
        // Tab is already created, just log the error
      }
    }, 0);
  };

  // Stable callbacks to prevent infinite re-renders
  const handleStreamingChange = useCallback((isStreaming: boolean, sessionId?: string) => {
    const tabId = activeTabIdRef.current;
    if (tabId) {
      updateTab(tabId, {
        status: isStreaming ? 'running' : 'idle',
        sessionId: sessionId,
      });
    }
  }, [updateTab]);

  const handleProjectPathChange = useCallback((path: string) => {
    const tabId = activeTabIdRef.current;
    if (tabId) {
      updateTab(tabId, { projectPath: path });
    }
  }, [updateTab]);

  const handleProviderChange = useCallback(async (providerId: string) => {
    const tabId = activeTabIdRef.current;
    const tab = tabId ? getTabById(tabId) : undefined;

    if (!tabId || !tab || tab.type !== 'chat') {
      console.warn('[WorkspaceContainer] Cannot change provider: no active chat tab');
      return;
    }

    try {
      // Save current provider's session before switching
      const currentProviderSessions = tab.providerSessions || {};
      if (tab.providerId && tab.sessionId && tab.sessionData) {
        currentProviderSessions[tab.providerId] = {
          sessionId: tab.sessionId,
          sessionData: tab.sessionData
        };
      }

      // Get the actual project path
      const actualProjectPath = tab.sessionData?.project_path || tab.projectPath || workspaceId;

      // Check if we have a previous session for this provider
      const previousSession = currentProviderSessions[providerId];

      if (previousSession) {
        // Restore previous session for this provider
        updateTab(tabId, {
          providerId,
          sessionData: previousSession.sessionData,
          sessionId: previousSession.sessionId,
          providerSessions: currentProviderSessions,
        });
      } else {
        // No previous session - load sessions and pick the latest one
        try {
          const sessionList = await providers.listSessions(actualProjectPath, providerId);

          if (sessionList.length === 0) {
            // No sessions exist - clear current session and start fresh
            updateTab(tabId, {
              providerId,
              sessionData: undefined,
              sessionId: undefined,
              providerSessions: currentProviderSessions,
            });
          } else {
            // Sort sessions by timestamp and select the latest one
            const sortedSessions = [...sessionList].sort((a, b) => {
              const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
              const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
              return timeB - timeA;
            });
            const latestSession = sortedSessions[0];

            // Add provider info to session
            const sessionWithProvider = {
              ...latestSession,
              provider: providerId
            };

            // Update tab with the latest session
            updateTab(tabId, {
              providerId,
              sessionData: sessionWithProvider,
              sessionId: latestSession.id,
              providerSessions: currentProviderSessions,
            });
          }
        } catch (err) {
          console.error(`[WorkspaceContainer] Failed to load sessions for provider ${providerId}:`, err);
          // Fallback: start fresh
          updateTab(tabId, {
            providerId,
            sessionData: undefined,
            sessionId: undefined,
            providerSessions: currentProviderSessions,
          });
        }
      }
    } catch (err) {
      console.error('[WorkspaceContainer] Failed to change provider:', err);
    }
  }, [updateTab, getTabById, workspaceId]);

  const handleBack = useCallback(() => {
    // Chat tab doesn't have a back button, this is a no-op
  }, []);

  // 判断 tab 是否需要保持挂载状态（有状态的 tab）
  const shouldKeepTabMounted = (tabType: string): boolean => {
    const STATEFUL_TAB_TYPES = new Set(['chat', 'agent-execution', 'claude-file', 'diff', 'file', 'webview']);
    return STATEFUL_TAB_TYPES.has(tabType);
  };

  const renderTabContent = (tab: typeof tabs[number]) => {
    const isActive = tab.id === activeTabId;

    switch (tab.type) {
      case 'chat':
        return (
          <AiCodeSession
            key={tab.id}
            session={tab.sessionData}
            initialProjectPath={tab.projectPath}
            defaultProvider={tab.providerId}
            onBack={handleBack}
            onStreamingChange={handleStreamingChange}
            onProjectPathChange={handleProjectPathChange}
            onProviderChange={handleProviderChange}
          />
        );

      case 'agent':
        if (!tab.agentRunId || !tab.id) {
          return <div className="flex items-center justify-center h-full">Invalid agent tab</div>;
        }
        return (
          <AgentRunOutputViewer
            agentRunId={tab.agentRunId}
            tabId={tab.id}
          />
        );

      case 'agent-execution':
        if (!tab.agentData) {
          return <div className="flex items-center justify-center h-full">Invalid agent execution tab</div>;
        }
        return (
          <AgentExecution
            agent={tab.agentData}
            projectPath={tab.projectPath}
            tabId={tab.id}
            onBack={() => {
              removeTab(tab.id);
            }}
          />
        );

      case 'diff':
        if (!tab.filePath || !tab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid diff tab</div>;
        }
        return (
          <DiffViewer
            filePath={tab.filePath}
            workspacePath={tab.projectPath}
          />
        );

      case 'file':
        if (!tab.filePath || !tab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid file tab</div>;
        }
        return (
          <FileViewer
            filePath={tab.filePath}
            workspacePath={tab.projectPath}
          />
        );

      case 'webview':
        if (!tab.url || !tab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid webview tab</div>;
        }
        return (
          <WebViewWidget
            url={tab.url}
            workspacePath={tab.projectPath}
            onUrlChange={(newUrl) => {
              updateTab(tab.id, { url: newUrl });
            }}
          />
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Unsupported tab type: {tab.type}</p>
          </div>
        );
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>No tabs</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      }
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const keepMounted = shouldKeepTabMounted(tab.type);

        // 对于有状态的 tab，使用 CSS hidden 控制显示；对于无状态的 tab，只渲染活动的
        if (!isActive && !keepMounted) {
          return null;
        }

        return (
          <div
            key={tab.id}
            className={`h-full w-full ${isActive ? '' : 'hidden'}`}
          >
            {renderTabContent(tab)}
          </div>
        );
      })}
    </Suspense>
  );
};

// 将 WorkspaceTabManager 渲染到标题栏的 Portal 组件
const WorkspaceTabManagerPortal: React.FC<{ visible: boolean }> = ({ visible }) => {
  const [slot, setSlot] = React.useState<HTMLElement | null>(() =>
    visible ? document.getElementById('workspace-tab-manager-slot') : null
  );

  // 每次渲染时同步检查 slot 是否仍然有效
  // 无依赖数组 = 每次渲染后都执行，确保 slot 引用始终正确
  React.useLayoutEffect(() => {
    if (!visible) {
      if (slot !== null) setSlot(null);
      return;
    }

    const element = document.getElementById('workspace-tab-manager-slot');
    if (slot !== element) {
      setSlot(element);
    }
  });

  // MutationObserver 处理 slot 元素被异步创建/销毁的情况
  React.useEffect(() => {
    if (!visible) return;

    const observer = new MutationObserver(() => {
      const element = document.getElementById('workspace-tab-manager-slot');
      setSlot(prev => prev !== element ? element : prev);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [visible]);

  if (!visible || !slot) {
    return null;
  }

  return createPortal(
    <WorkspaceTabManager className="self-stretch" />,
    slot
  );
};

export const WorkspaceContainer: React.FC<WorkspaceContainerProps> = ({ workspaceId, visible }) => {
  const [rightSidebarOpen, setRightSidebarOpen] = React.useState(true);

  // 监听全局 toggle-right-sidebar 事件
  React.useEffect(() => {
    const handleToggle = () => {
      if (visible) {
        setRightSidebarOpen(prev => !prev);
      }
    };

    window.addEventListener('toggle-right-sidebar', handleToggle);
    return () => window.removeEventListener('toggle-right-sidebar', handleToggle);
  }, [visible]);

  return (
    <WorkspaceTabProvider workspaceId={workspaceId}>
      {/* Portal: 将 TabManager 渲染到标题栏 */}
      <WorkspaceTabManagerPortal visible={visible} />

      <div className={`h-full w-full flex ${visible ? '' : 'hidden'}`}>
        {/* 中间栏 - 使用 flex-1 占据剩余空间 */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceContent workspaceId={workspaceId} />
        </div>
        {/* 右侧栏 - 默认 35% 宽度 */}
        <RightSidebar
          isOpen={rightSidebarOpen}
          onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
          defaultWidthPercent={35}
          currentProjectPath={workspaceId}
        />
      </div>
    </WorkspaceTabProvider>
  );
};

export default WorkspaceContainer;
