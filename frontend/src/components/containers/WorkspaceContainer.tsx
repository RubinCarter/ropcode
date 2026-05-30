import React, { Suspense, lazy, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceTabProvider, useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import { RightSidebar } from '@/components/right-sidebar';
import { Loader2 } from 'lucide-react';
import { providers } from '@/lib/providers';
import { useIsMobile } from '@/hooks/useIsMobile';
import { WorkspaceTabManager } from './WorkspaceTabManager';
import type { ProviderSessionSummary } from '@/lib/api';
import * as rpcClient from '@/lib/rpc-client';
import { useTranslation } from 'react-i18next';

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer').then(m => ({ default: m.AgentRunOutputViewer })));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewWidget = lazy(() => import('@/components/WebViewWidget').then(m => ({ default: m.WebViewWidget })));

const CHAT_PROVIDERS = ['claude', 'codex', 'deepseek', 'pi'] as const;

interface WorkspaceContainerProps {
  workspaceId: string;
  visible: boolean;
}

type OpenProviderSessionEvent = CustomEvent<{
  spacePath: string;
  session: ProviderSessionSummary;
}>;

type OpenNewSessionEvent = CustomEvent<{
  spacePath: string;
}>;

const getHistoricalSessionTitle = (session: ProviderSessionSummary) => {
  const title = session.title || session.first_message;
  if (title?.trim()) return title.trim();
  return `${session.provider} session`;
};

const WorkspaceContent: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const { tabs, activeTabId, addTab, updateTab, removeTab, getTabById, setActiveTab } = useWorkspaceTabContext();
  const { t } = useTranslation();
  const activeTabIdRef = React.useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = React.useRef(tabs);
  tabsRef.current = tabs;
  const openedHistoricalSessionRef = React.useRef(false);
  const lastHandledNewSessionRef = React.useRef<string | null>(null);

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
    const pendingNewSession = (window as any).__ROPCODE_PENDING_NEW_SESSION__;
    if (pendingNewSession?.spacePath === workspaceId) {
      delete (window as any).__ROPCODE_PENDING_NEW_SESSION__;
      addTab({
        type: 'chat',
        title: 'New chat',
        sessionId: undefined,
        sessionData: undefined,
        providerSessions: undefined,
        projectPath: workspaceId,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
        skipSessionRestore: true,
        sessionResetNonce: 1,
      });
      return;
    }

    const pending = (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__;
    if (pending?.spacePath === workspaceId && pending.session) {
      const session = pending.session as ProviderSessionSummary;
      openedHistoricalSessionRef.current = true;
      delete (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__;
      addTab({
        type: 'chat',
        title: getHistoricalSessionTitle(session),
        sessionId: session.id,
        sessionData: session,
        projectPath: workspaceId,
        providerId: session.provider,
        status: session.is_running ? 'running' : 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
      return;
    }

    // Step 1: Immediately add an empty chat tab (non-blocking)
    // This allows the UI to render immediately without waiting for session list
    const newTabId = addTab({
      type: 'chat',
      title: t('tabs.chat'),
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
        const providerSessions = await Promise.all(
          CHAT_PROVIDERS.map(async (providerId) => {
            const sessionList = await providers.listSessions(workspaceId, providerId);
            return sessionList.map(session => ({ ...session, provider: providerId }));
          })
        );
        const sessionList = providerSessions.flat();
        if (sessionList.length > 0) {
          const [selectedSession] = [...sessionList].sort((a, b) => {
            const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
            const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
            return timeB - timeA;
          });

          if (openedHistoricalSessionRef.current) {
            return;
          }

          // Update the tab with session data
          if (tabIdRef.current) {
            const initialTab = tabsRef.current.find(tab => tab.id === tabIdRef.current);
            if (initialTab?.skipSessionRestore) {
              return;
            }

            updateTab(tabIdRef.current, {
              providerId: selectedSession.provider,
              sessionId: selectedSession.id,
              sessionData: selectedSession,
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
  const handleStreamingChange = useCallback((tabId: string, isStreaming: boolean, sessionId?: string | null) => {
    updateTab(tabId, {
      status: isStreaming ? 'running' : 'idle',
      sessionId: sessionId || undefined,
    });
  }, [getTabById, updateTab]);

  const handleProcessAliveChange = useCallback((tabId: string, isAlive: boolean) => {
    const tab = getTabById(tabId);
    if (!tab || tab.type !== 'chat' || tab.status === 'running') {
      return;
    }

    updateTab(tabId, {
      status: isAlive ? 'idle' : 'closed',
    });
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
      // ProjectChat mode: use unified cross-provider chat
      if (tab.projectChatId) {
        const currentModel = tab.sessionData?.model || '';
        const result = await rpcClient.SwitchProjectChatProvider(
          tab.projectChatId, providerId, currentModel
        );

        const newSegment = {
          id: result.segment_id,
          provider: result.provider,
          model: result.model,
          runtimeSessionId: result.runtime_session_id,
          streamId: result.stream_id,
          seq: (tab.projectChatSegments?.length || 0),
        };

        updateTab(tabId, {
          providerId,
          sessionId: result.runtime_session_id,
          projectChatSegments: [
            ...(tab.projectChatSegments || []),
            newSegment,
          ],
        });
        return;
      }

      const actualProjectPath = tab.sessionData?.project_path || tab.projectPath || workspaceId;
      if (tab.skipSessionRestore && !tab.sessionId && !tab.sessionData) {
        updateTab(tabId, {
          providerId,
          sessionData: undefined,
          sessionId: undefined,
          providerSessions: undefined,
        });
        return;
      }

      if (!actualProjectPath) {
        updateTab(tabId, {
          providerId,
          sessionData: undefined,
          sessionId: undefined,
          providerSessions: undefined,
        });
        return;
      }

      const chat = await rpcClient.CreateProjectChat(
        actualProjectPath,
        tab.providerId || providerId,
        tab.sessionData?.model || '',
        '',
        tab.sessionId || ''
      );

      const initialSegment = {
        id: chat.segment_id,
        provider: tab.providerId || providerId,
        model: tab.sessionData?.model || '',
        runtimeSessionId: chat.runtime_session_id,
        streamId: chat.stream_id,
        seq: 0,
      };

      if ((tab.providerId || providerId) === providerId) {
        updateTab(tabId, {
          providerId,
          sessionId: chat.runtime_session_id,
          projectChatId: chat.chat_id,
          projectChatSegments: [initialSegment],
        });
        return;
      }

      const result = await rpcClient.SwitchProjectChatProvider(
        chat.chat_id, providerId, tab.sessionData?.model || ''
      );

      const newSegment = {
        id: result.segment_id,
        provider: result.provider,
        model: result.model,
        runtimeSessionId: result.runtime_session_id,
        streamId: result.stream_id,
        seq: 1,
      };

      updateTab(tabId, {
        providerId,
        sessionId: result.runtime_session_id,
        projectChatId: chat.chat_id,
        projectChatSegments: [initialSegment, newSegment],
      });
    } catch (err) {
      console.error('[WorkspaceContainer] Failed to change provider:', err);
    }
  }, [updateTab, getTabById, workspaceId]);

  const handleBack = useCallback(() => {
    // Chat tab doesn't have a back button, this is a no-op
  }, []);

  const handleSessionActivityComplete = useCallback((tabId: string, sessionId?: string | null) => {
    if (sessionId) {
      updateTab(tabId, { sessionId });
    }

    window.dispatchEvent(new CustomEvent('ropcode-space-sessions-refresh', {
      detail: { spacePath: workspaceId, sessionId, force: true },
    }));
  }, [updateTab, workspaceId]);

  useEffect(() => {
    const handleOpenProviderSession = (event: Event) => {
      const { spacePath, session } = (event as OpenProviderSessionEvent).detail ?? {};
      if (spacePath !== workspaceId || !session) return;
      openedHistoricalSessionRef.current = true;
      const pending = (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__;
      if (pending?.spacePath === workspaceId && pending.session?.id === session.id) {
        delete (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__;
      }

      const existingTab = tabs.find(tab =>
        tab.type === 'chat' &&
        tab.sessionId === session.id &&
        tab.providerId === session.provider
      );
      if (existingTab) {
        setActiveTab(existingTab.id);
        return;
      }

      addTab({
        type: 'chat',
        title: getHistoricalSessionTitle(session),
        sessionId: session.id,
        sessionData: session,
        projectPath: spacePath,
        providerId: session.provider,
        status: session.is_running ? 'running' : 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
    };

    window.addEventListener('open-provider-session', handleOpenProviderSession);
    const pending = (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__;
    if (pending?.spacePath === workspaceId && pending.session) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-provider-session', {
          detail: pending,
        }));
      }, 0);
    }
    return () => window.removeEventListener('open-provider-session', handleOpenProviderSession);
  }, [addTab, setActiveTab, tabs, workspaceId]);

  useEffect(() => {
    const handleOpenNewSession = (event: Event) => {
      const { spacePath } = (event as OpenNewSessionEvent).detail ?? {};
      if (spacePath !== workspaceId) return;

      const newSessionKey = `${spacePath}:${Math.floor(performance.now() / 250)}`;
      if (lastHandledNewSessionRef.current === newSessionKey) {
        return;
      }
      lastHandledNewSessionRef.current = newSessionKey;

      const pending = (window as any).__ROPCODE_PENDING_NEW_SESSION__;
      if (pending?.spacePath === workspaceId) {
        delete (window as any).__ROPCODE_PENDING_NEW_SESSION__;
      }

      const currentTabs = tabsRef.current;
      const existingNewSessionTab = currentTabs.find(tab =>
        tab.type === 'chat' &&
        tab.skipSessionRestore === true &&
        !tab.sessionId &&
        !tab.sessionData
      );
      if (existingNewSessionTab) {
        setActiveTab(existingNewSessionTab.id);
        return;
      }

      const activeTab = activeTabIdRef.current ? currentTabs.find(tab => tab.id === activeTabIdRef.current) : undefined;
      const replacementTab = activeTab?.type === 'chat'
        ? activeTab
        : currentTabs.find(tab => tab.type === 'chat');
      if (replacementTab) {
        updateTab(replacementTab.id, {
          title: 'New chat',
          providerId: 'claude',
          sessionId: undefined,
          sessionData: undefined,
          providerSessions: undefined,
          status: 'idle',
          skipSessionRestore: true,
          sessionResetNonce: (replacementTab.sessionResetNonce ?? 0) + 1,
        });
        setActiveTab(replacementTab.id);
        return;
      }

      const existingBlankChatTab = currentTabs.find(tab =>
        tab.type === 'chat' &&
        !tab.sessionId &&
        !tab.sessionData
      );
      if (existingBlankChatTab) {
        updateTab(existingBlankChatTab.id, {
          title: 'New chat',
          providerId: existingBlankChatTab.providerId || 'claude',
          sessionId: undefined,
          sessionData: undefined,
          providerSessions: undefined,
          skipSessionRestore: true,
          sessionResetNonce: (existingBlankChatTab.sessionResetNonce ?? 0) + 1,
        });
        setActiveTab(existingBlankChatTab.id);
        return;
      }

      addTab({
        type: 'chat',
        title: 'New chat',
        sessionId: undefined,
        sessionData: undefined,
        providerSessions: undefined,
        projectPath: spacePath,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
        skipSessionRestore: true,
        sessionResetNonce: 1,
      });
    };

    window.addEventListener('open-new-session', handleOpenNewSession);
    const pending = (window as any).__ROPCODE_PENDING_NEW_SESSION__;
    if (pending?.spacePath === workspaceId) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-new-session', {
          detail: pending,
        }));
      }, 0);
    }
    return () => window.removeEventListener('open-new-session', handleOpenNewSession);
  }, [addTab, setActiveTab, tabs, workspaceId]);

  // Determine if tab should stay mounted (stateful tabs)
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
            key={`${tab.id}-${tab.sessionResetNonce ?? 0}`}
            session={tab.sessionData}
            initialProjectPath={tab.projectPath}
            defaultProvider={tab.providerId}
            skipSessionRestore={tab.skipSessionRestore}
            projectChatId={tab.projectChatId}
            projectChatSegments={tab.projectChatSegments}
            onBack={handleBack}
            onStreamingChange={(isStreaming, sessionId) => handleStreamingChange(tab.id, isStreaming, sessionId)}
            onProcessAliveChange={(isAlive) => handleProcessAliveChange(tab.id, isAlive)}
            onProjectPathChange={handleProjectPathChange}
            onProviderChange={handleProviderChange}
            onSessionTitleGenerated={(title) => updateTab(tab.id, { title })}
            onSessionActivityComplete={(sessionId) => handleSessionActivityComplete(tab.id, sessionId)}
            onProjectChatCreated={(chatId, streamId, segmentId) => {
              updateTab(tab.id, {
                projectChatId: chatId,
                projectChatSegments: [{
                  id: segmentId || chatId,
                  provider: tab.providerId || 'claude',
                  model: '',
                  runtimeSessionId: '',
                  streamId,
                  seq: 0,
                }],
              });
            }}
            onProjectChatSegmentRuntimeSession={(segmentId, runtimeSessionId) => {
              updateTab(tab.id, {
                sessionId: runtimeSessionId,
                projectChatSegments: (tab.projectChatSegments || []).map((segment) =>
                  segment.id === segmentId
                    ? { ...segment, runtimeSessionId }
                    : segment
                ),
              });
            }}
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
            gitStatus={tab.gitStatus}
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

        // For stateful tabs, use CSS hidden; for stateless tabs, only render active one
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

// Portal component that renders WorkspaceTabManager into titlebar
const WorkspaceTabManagerPortal: React.FC<{ visible: boolean }> = ({ visible }) => {
  const [slot, setSlot] = React.useState<HTMLElement | null>(() =>
    visible ? document.getElementById('workspace-tab-manager-slot') : null
  );

  // Synchronously check if slot is still valid on each render
  // No dependency array = execute after every render, ensure slot ref is always correct
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

  // MutationObserver handles async creation/destruction of slot elements
  React.useEffect(() => {
    if (!visible) return;

    const observer = new MutationObserver(() => {
      const element = document.getElementById('workspace-tab-manager-slot');
      setSlot(prev => prev !== element ? element : prev);
    });

    const target = document.getElementById('workspace-tab-manager-slot')?.parentElement || document.body;
    observer.observe(target, {
      childList: true,
      subtree: false,
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
  const isMobile = useIsMobile();

  // Listen for global toggle-right-sidebar events
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
      {/* Portal: render TabManager into titlebar */}
      <WorkspaceTabManagerPortal visible={visible} />

      <div className={`h-full w-full flex ${visible ? '' : 'hidden'}`}>
        {/* Middle section - flex-1 takes remaining space */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceContent workspaceId={workspaceId} />
        </div>
        {/* Right sidebar - default 35% width */}
        {!isMobile && (
          <RightSidebar
            isOpen={rightSidebarOpen}
            onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
            visible={visible}
            defaultWidthPercent={35}
            currentProjectPath={workspaceId}
          />
        )}
      </div>
    </WorkspaceTabProvider>
  );
};

export default WorkspaceContainer;
