import React, { Suspense, lazy, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceTabProvider, useWorkspaceTabContext, type WorkspaceTab } from '@/contexts/WorkspaceTabContext';
import { RightSidebar } from '@/components/right-sidebar';
import { Loader2 } from 'lucide-react';
import { providers } from '@/lib/providers';
import { useIsMobile } from '@/hooks/useIsMobile';
import { WorkspaceTabManager } from './WorkspaceTabManager';
import type { ProviderSessionSummary } from '@/lib/api';
import * as rpcClient from '@/lib/rpc-client';
import { projectChatExistingSessionId, projectChatSegmentFromSwitchResult } from '@/lib/projectChatSession';
import { useProjectChatSegments } from '@/hooks/useProjectChatSegments';
import {
  loadAgentExecution,
  loadAgentRunOutputViewer,
  loadAiCodeSession,
  loadDiffViewer,
  loadFileViewer,
  loadWebViewWidget,
} from '@/lib/lazyModules';
import {
  getProjectChatSegments,
  setProjectChatSegments,
  updateProjectChatSegmentRuntimeSession,
  upsertProjectChatSegment,
  type ProjectChatSegment,
} from '@/stores/projectChatSegmentStore';
import { useTranslation } from 'react-i18next';

// Lazy load heavy components
const AiCodeSession = lazy(loadAiCodeSession);
const AgentRunOutputViewer = lazy(loadAgentRunOutputViewer);
const AgentExecution = lazy(loadAgentExecution);
const DiffViewer = lazy(loadDiffViewer);
const FileViewer = lazy(loadFileViewer);
const WebViewWidget = lazy(loadWebViewWidget);

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

interface WorkspaceProjectChatSeed {
  chatId: string;
  providerId: string;
  sessionId?: string;
  segment: ProjectChatSegment;
  segments: ProjectChatSegment[];
  restoredExisting: boolean;
}

async function ensureProjectChatForHistoricalSession(
  spacePath: string,
  session: ProviderSessionSummary,
) {
  const model = session.model || '';
  const chat = await rpcClient.EnsureProjectChat(
    spacePath,
    session.provider,
    model,
    '',
    projectChatExistingSessionId(session),
  );
  const segment = projectChatSegmentFromSwitchResult(chat, session.provider, model, 0);
  const segments = await hydrateProjectChatSegments(chat.chat_id, segment, session.provider);

  return {
    chat,
    segment: segments.find(item => item.id === chat.segment_id) || segment,
    segments,
  };
}

async function ensureProjectChatForTabSession(
  spacePath: string,
  providerId: string,
  session?: ProviderSessionSummary,
  forceNew = false,
) {
  const model = session?.model || '';
  const chat = await rpcClient.EnsureProjectChat(
    spacePath,
    providerId,
    model,
    '',
    session ? projectChatExistingSessionId(session) : '',
    forceNew,
  );
  const segment = projectChatSegmentFromSwitchResult(chat, providerId, model, 0);
  const segments = await hydrateProjectChatSegments(chat.chat_id, segment, providerId);

  return {
    chat,
    segment: segments.find(item => item.id === chat.segment_id) || segment,
    segments,
  };
}

function projectChatSegmentFromStoredSegment(
  chatId: string,
  segment: rpcClient.ChatSegment,
  fallbackProvider: string,
): ProjectChatSegment {
  return {
    id: segment.id,
    provider: segment.provider || fallbackProvider,
    model: segment.model || '',
    runtimeSessionId: segment.runtime_session_id || '',
    streamId: chatId,
    seq: segment.seq,
  };
}

function projectChatSegmentsFromStoredSegments(
  chatId: string,
  segments: rpcClient.ChatSegment[],
  fallbackProvider: string,
): ProjectChatSegment[] {
  return segments.map(segment => projectChatSegmentFromStoredSegment(chatId, segment, fallbackProvider));
}

async function hydrateProjectChatSegments(
  chatId: string,
  fallbackSegment: ProjectChatSegment,
  fallbackProvider: string,
): Promise<ProjectChatSegment[]> {
  const detail = await rpcClient.GetProjectChat(chatId);
  const segments = projectChatSegmentsFromStoredSegments(
    chatId,
    detail.segments,
    detail.chat.active_provider || fallbackProvider,
  );
  const nextSegments = segments.length > 0 ? segments : [fallbackSegment];
  setProjectChatSegments(chatId, nextSegments);
  return nextSegments;
}

async function loadActiveProjectChatForWorkspace(spacePath: string): Promise<WorkspaceProjectChatSeed | null> {
  const activeChat = await rpcClient.GetActiveChatForProject(spacePath);
  if (!activeChat?.id) {
    return null;
  }

  const detail = await rpcClient.GetProjectChat(activeChat.id);
  const segments = projectChatSegmentsFromStoredSegments(
    activeChat.id,
    detail.segments,
    activeChat.active_provider || 'claude',
  );
  setProjectChatSegments(activeChat.id, segments);
  const activeSegment = detail.segments.find(segment => segment.id === activeChat.active_segment_id)
    || detail.segments[detail.segments.length - 1];
  if (!activeSegment) {
    return null;
  }

  const segment = projectChatSegmentFromStoredSegment(
    activeChat.id,
    activeSegment,
    activeChat.active_provider || activeSegment.provider || 'claude',
  );

  return {
    chatId: activeChat.id,
    providerId: segment.provider,
    sessionId: segment.runtimeSessionId || undefined,
    segment,
    segments,
    restoredExisting: true,
  };
}

async function getInitialProjectChatForWorkspace(spacePath: string): Promise<WorkspaceProjectChatSeed> {
  const activeProjectChat = await loadActiveProjectChatForWorkspace(spacePath);
  if (activeProjectChat) {
    return activeProjectChat;
  }

  const projectChat = await ensureProjectChatForTabSession(spacePath, 'claude');
  return {
    chatId: projectChat.chat.chat_id,
    providerId: projectChat.segment.provider || 'claude',
    sessionId: projectChat.chat.runtime_session_id || undefined,
    segment: projectChat.segment,
    segments: projectChat.segments,
    restoredExisting: false,
  };
}

interface WorkspaceChatSessionProps {
  tab: WorkspaceTab;
  onBack: () => void;
  onStreamingChange: (tabId: string, isStreaming: boolean, sessionId?: string | null) => void;
  onProcessAliveChange: (tabId: string, isAlive: boolean) => void;
  onProjectPathChange: (path: string) => void;
  onProviderChange: (providerId: string) => void;
  onSessionTitleGenerated: (tabId: string, title: string) => void;
  onSessionActivityComplete: (tabId: string, sessionId?: string | null) => void;
  updateTab: ReturnType<typeof useWorkspaceTabContext>['updateTab'];
}

const WorkspaceChatSession: React.FC<WorkspaceChatSessionProps> = ({
  tab,
  onBack,
  onStreamingChange,
  onProcessAliveChange,
  onProjectPathChange,
  onProviderChange,
  onSessionTitleGenerated,
  onSessionActivityComplete,
  updateTab,
}) => {
  const projectChatSegments = useProjectChatSegments(tab.projectChatId);

  return (
    <AiCodeSession
      key={`${tab.id}-${tab.sessionResetNonce ?? 0}`}
      session={tab.sessionData}
      initialProjectPath={tab.projectPath}
      defaultProvider={tab.providerId}
      skipSessionRestore={tab.skipSessionRestore}
      projectChatId={tab.projectChatId}
      projectChatSegments={projectChatSegments}
      onBack={onBack}
      onStreamingChange={(isStreaming, sessionId) => onStreamingChange(tab.id, isStreaming, sessionId)}
      onProcessAliveChange={(isAlive) => onProcessAliveChange(tab.id, isAlive)}
      onProjectPathChange={onProjectPathChange}
      onProviderChange={onProviderChange}
      onSessionTitleGenerated={(title) => onSessionTitleGenerated(tab.id, title)}
      onSessionActivityComplete={(sessionId) => onSessionActivityComplete(tab.id, sessionId)}
      onProjectChatSegmentRuntimeSession={(segmentId, runtimeSessionId) => {
        if (tab.projectChatId) {
          updateProjectChatSegmentRuntimeSession(tab.projectChatId, segmentId, runtimeSessionId);
        }
        updateTab(tab.id, { sessionId: runtimeSessionId });
      }}
    />
  );
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
      const projectChat = await ensureProjectChatForTabSession(workspaceId, 'claude', undefined, true);
      addTab({
        type: 'chat',
        title: 'New chat',
        sessionId: projectChat.chat.runtime_session_id || undefined,
        sessionData: undefined,
        providerSessions: undefined,
        projectPath: workspaceId,
        providerId: 'claude',
        projectChatId: projectChat.chat.chat_id,
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
      const projectChat = await ensureProjectChatForHistoricalSession(workspaceId, session);
      addTab({
        type: 'chat',
        title: getHistoricalSessionTitle(session),
        sessionId: projectChat.chat.runtime_session_id || session.id,
        sessionData: session,
        projectPath: workspaceId,
        providerId: session.provider,
        projectChatId: projectChat.chat.chat_id,
        status: session.is_running ? 'running' : 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
      return;
    }

    // Step 1: Add the active ProjectChat tab without forcing the provider back to Claude.
    const projectChat = await getInitialProjectChatForWorkspace(workspaceId);
    const restoredExistingProjectChat = projectChat.restoredExisting;
    const newTabId = addTab({
      type: 'chat',
      title: t('tabs.chat'),
      sessionId: projectChat.sessionId,
      sessionData: undefined,
      projectPath: workspaceId,
      providerId: projectChat.providerId,
      projectChatId: projectChat.chatId,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'message-square',
    });
    tabIdRef.current = newTabId;

    // Step 2: Load sessions in the background (non-blocking)
    // Use setTimeout to yield to the browser and allow initial render
    setTimeout(async () => {
      try {
        if (restoredExistingProjectChat) {
          return;
        }

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
          }) as ProviderSessionSummary[];

          if (openedHistoricalSessionRef.current) {
            return;
          }

          // Update the tab with session data
          if (tabIdRef.current) {
            const initialTab = tabsRef.current.find(tab => tab.id === tabIdRef.current);
            if (initialTab?.skipSessionRestore) {
              return;
            }

            const restoredProjectChat = await ensureProjectChatForHistoricalSession(workspaceId, selectedSession);
            let nextProjectChatId = restoredProjectChat.chat.chat_id;
            let nextSegments = restoredProjectChat.segments;
            let nextSessionId = selectedSession.id;

            if (initialTab?.projectChatId && initialTab.providerId !== selectedSession.provider) {
              const result = await rpcClient.SwitchProjectChatProvider(
                restoredProjectChat.chat.chat_id,
                selectedSession.provider,
                selectedSession.model || ''
              );
              const newSegment = projectChatSegmentFromSwitchResult(
                result,
                selectedSession.provider,
                selectedSession.model || '',
                nextSegments.length
              );
              nextSegments = [...nextSegments, newSegment];
              setProjectChatSegments(nextProjectChatId, nextSegments);
              nextSessionId = result.runtime_session_id || selectedSession.id;
            } else {
              nextSessionId = restoredProjectChat.chat.runtime_session_id || selectedSession.id;
            }

            updateTab(tabIdRef.current, {
              providerId: selectedSession.provider,
              sessionId: nextSessionId,
              sessionData: selectedSession,
              projectChatId: nextProjectChatId,
              allowProjectChatRebind: true,
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
      if (!tab.projectChatId) {
        console.warn('[WorkspaceContainer] ProjectChat is not ready for provider change');
        return;
      }

      if (tab.providerId === providerId) {
        updateTab(tabId, { providerId });
        return;
      }
      const currentModel = tab.sessionData?.model || '';
      let currentSegments = getProjectChatSegments(tab.projectChatId);
      if (currentSegments.length === 0) {
        const detail = await rpcClient.GetProjectChat(tab.projectChatId);
        currentSegments = projectChatSegmentsFromStoredSegments(
          tab.projectChatId,
          detail.segments,
          detail.chat.active_provider || tab.providerId || 'claude',
        );
        setProjectChatSegments(tab.projectChatId, currentSegments);
      }
      const result = await rpcClient.SwitchProjectChatProvider(
        tab.projectChatId, providerId, currentModel
      );

      const newSegment = projectChatSegmentFromSwitchResult(result, providerId, currentModel, currentSegments.length);
      upsertProjectChatSegment(tab.projectChatId, newSegment);

      updateTab(tabId, {
        providerId,
        sessionId: result.runtime_session_id,
        projectChatId: tab.projectChatId,
      });
    } catch (err) {
      console.error('[WorkspaceContainer] Failed to change provider:', err);
    }
  }, [updateTab, getTabById]);

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
    const handleOpenProviderSession = async (event: Event) => {
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

      const projectChat = await ensureProjectChatForHistoricalSession(spacePath, session);

      addTab({
        type: 'chat',
        title: getHistoricalSessionTitle(session),
        sessionId: projectChat.chat.runtime_session_id || session.id,
        sessionData: session,
        projectPath: spacePath,
        providerId: session.provider,
        projectChatId: projectChat.chat.chat_id,
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
    const handleOpenNewSession = async (event: Event) => {
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
        !tab.sessionData
      );
      if (existingNewSessionTab) {
        setActiveTab(existingNewSessionTab.id);
        return;
      }

      const projectChat = await ensureProjectChatForTabSession(spacePath, 'claude', undefined, true);
      addTab({
        type: 'chat',
        title: 'New chat',
        sessionId: projectChat.chat.runtime_session_id || undefined,
        sessionData: undefined,
        providerSessions: undefined,
        projectPath: spacePath,
        providerId: 'claude',
        projectChatId: projectChat.chat.chat_id,
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
          <WorkspaceChatSession
            tab={tab}
            onBack={handleBack}
            onStreamingChange={handleStreamingChange}
            onProcessAliveChange={handleProcessAliveChange}
            onProjectPathChange={handleProjectPathChange}
            onProviderChange={handleProviderChange}
            onSessionTitleGenerated={(tabId, title) => updateTab(tabId, { title })}
            onSessionActivityComplete={handleSessionActivityComplete}
            updateTab={updateTab}
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
