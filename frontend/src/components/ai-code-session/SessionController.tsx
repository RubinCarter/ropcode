/**
 * AI Code Session Component - Refactored with Hooks
 *
 * This is the complete refactored version that replaces ClaudeCodeSession.tsx
 * All business logic has been extracted to dedicated hooks for better maintainability.
 *
 * Key improvements:
 * - Reduced main component complexity
 * - Clear separation of concerns via hooks
 * - Better testability
 * - Easier to understand and maintain
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type FloatingPromptInputRef } from "../FloatingPromptInput";
import { WebviewPreview } from "../WebviewPreview";
import { type VirtuosoHandle } from "react-virtuoso";
import { useTrackEvent, useComponentMetrics, useWorkflowTracking, useSubagentTranscriptSync } from "@/hooks";
import { useRuntimeTracker } from "./state/runtimeTrackerStore";
import { useSessionRuntime } from "@/hooks/useSessionRuntime";
import { type SessionStatusPromptConfig } from "./utils/sessionStatusBarPresentation";
import { generateSessionTitleViaEvent } from "@/lib/titleGeneration";
import { useWorkspaceTodo } from "@/contexts/WorkspaceTodoContext";
import { RuntimeStatusBar } from "./runtime/RuntimeStatusBar";
import { SessionStreamProvider } from "./transport/SessionStreamProvider";
import { SessionMessagePane } from "./messages/SessionMessagePane";
import { SessionLayoutChrome } from "./layout/SessionLayoutChrome";
import { CopyConversationMenu } from "./composer/CopyConversationMenu";
import { LoadProjectChatHistory } from "@/lib/rpc-client";
import { EventsOn } from "@/lib/rpc-events";
import { writeRendererDiagnostic } from "@/lib/rendererDiagnostics";
import { clearSessionFrames, mergeSessionFrames } from "@/stores/sessionFrameStore";
import { clearSessionRuntime } from "@/stores/sessionRuntimeStore";
import { resolveSessionProvider } from "@/lib/session-frame/provider";

// Import refactored hooks and types
import type { AiCodeSessionProps } from "./types";
import {
  useSessionState,
  useSessionMessages,
  useProcessState,
  usePromptQueue,
  useSessionMetrics,
  useSessionFrameEvents,
  useProviderApiSwitchNotice,
  useSessionHistoryLoader,
  useSessionPreview,
  useSessionRecovery,
  useSessionControllerLifecycle,
  useGeneratedSessionTitlePersistence,
  useElementSelectionPrompt,
  useSessionRuntimeStatusModel,
  useSessionPromptActions,
  useStopStatusFeedback,
  useTransportStatus,
  useVirtuosoRemeasure,
} from "./hooks";

const streamingViewportIncrease = { top: 100, bottom: 250 };
const idleViewportIncrease = { top: 300, bottom: 600 };
const projectChatHistoryBackfillIntervalMs = 3000;

function streamIdForRuntimeSession(provider: string, runtimeSessionId?: string | null): string | null {
  if (!runtimeSessionId) {
    return null;
  }
  return `${resolveSessionProvider(provider)}:${runtimeSessionId}`;
}

interface ProjectChatClearedEvent {
  chat_id?: string;
  stream_id?: string;
  segment_id?: string;
  previous_segment_id?: string;
}

/**
 * AI Code Session component for interactive AI coding sessions
 *
 * @example
 * <AiCodeSession onBack={() => setView('projects')} />
 */
export const SessionController: React.FC<AiCodeSessionProps> = ({
  session,
  initialProjectPath = "",
  className,
  onStreamingChange,
  onProcessAliveChange,
  onProjectPathChange,
  defaultProvider = "claude",
  skipSessionRestore = false,
  onProviderChange,
  onSessionTitleGenerated,
  onSessionActivityComplete,
  projectChatId,
}) => {
  // ==================================================================
  // REFS (Must be declared before hooks that use them)
  // ==================================================================

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);
  const loadedSessionIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const skipRecoveryUntilRef = useRef(0);
  const pendingFreshProviderSessionRef = useRef(skipSessionRestore);
  const generatedSessionTitleRef = useRef<string | null>(null);
  const firstPromptForTitleRef = useRef<string | null>(null);
  const sendPromptRef = useRef<(
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    provider?: string,
  ) => Promise<boolean>>(async () => false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastHandledClearEventRef = useRef<string | null>(null);
  const clearResetQueuedRef = useRef(false);
  // ==================================================================

  useEffect(() => {
    if (skipSessionRestore) {
      pendingFreshProviderSessionRef.current = true;
    }
  }, [skipSessionRestore, defaultProvider]);

  // Session state
  const sessionState = useSessionState({
    session,
    initialProjectPath,
  });

  // Messages state
  const messagesState = useSessionMessages();

  // Process state
  const processState = useProcessState({
    projectPath: sessionState.projectPath,
    provider: defaultProvider,
    activeRuntimeSessionId: undefined,
  });

  // Session metrics
  const metricsState = useSessionMetrics({
    wasResumed: !!session,
  });

  // Analytics
  const trackEvent = useTrackEvent();
  useComponentMetrics('AiCodeSession');
  const workflowTracking = useWorkflowTracking('ai_session');

  const runtimeTracker = useRuntimeTracker(sessionState.projectPath);
  const [promptConfig, setPromptConfig] = useState<SessionStatusPromptConfig>({
    provider: defaultProvider,
    model: 'sonnet',
    providerApiId: null,
    thinkingMode: defaultProvider === 'codex' || defaultProvider === 'pi' ? 'medium' : 'auto',
  });
  const providerApiSwitchNotice = useProviderApiSwitchNotice({
    isLoading: processState.isLoading,
  });
  const [generatedSessionTitle, setGeneratedSessionTitle] = useState<string | null>(null);
  const { getInProgressTodos } = useWorkspaceTodo();

  // Prompt queue - defined before eventsState
  const queueState = usePromptQueue({
    onProcessNext: (prompt) => {
      void sendPromptRef.current(prompt.prompt, prompt.model, prompt.providerApiId, prompt.thinkingMode, prompt.provider);
    },
  });

  const refreshSubagentTranscripts = useCallback(async (sessionId?: string | null, projectId?: string | null) => {
    if (!sessionId || !projectId) {
      messagesState.setSubagentTranscripts({});
      return;
    }

    try {
      const transcripts = await api.loadSubagentTranscripts(sessionId, projectId);
      messagesState.setSubagentTranscripts(transcripts || {});
    } catch (err) {
      console.warn('[AiCodeSession] Failed to load subagent transcripts:', err);
    }
  }, [messagesState.setSubagentTranscripts]);

  const refreshCurrentSubagentTranscripts = useCallback(async (sessionIdOverride?: string | null) => {
    messagesState.flushPendingMessages();
    const sessionInfo = sessionState.extractedSessionInfoRef.current;
    const initMessage = messagesState.messagesRef.current.find((message) => message.type === 'system' && message.subtype === 'init') as any;
    const realSessionId = sessionInfo?.claudeSessionId || initMessage?.claude_session_id || initMessage?.sessionId || initMessage?.session_id || sessionInfo?.sessionId;
    const sessionId = realSessionId || sessionIdOverride || sessionState.claudeSessionIdRef.current;
    const projectId = sessionInfo?.projectId || (initMessage?.cwd || sessionState.projectPathRef.current || '').replace(/[^a-zA-Z0-9]/g, '-');
    await refreshSubagentTranscripts(sessionId, projectId);
  }, [messagesState.flushPendingMessages, messagesState.messagesRef, refreshSubagentTranscripts, sessionState.claudeSessionIdRef, sessionState.extractedSessionInfoRef, sessionState.projectPathRef]);

  const liveSubagentSessionInfo = React.useMemo(() => {
    const sessionInfo = sessionState.extractedSessionInfo;
    const initMessage = messagesState.messages.find((message) => message.type === 'system' && message.subtype === 'init') as any;
    const realSessionId = sessionInfo?.claudeSessionId || initMessage?.claude_session_id || initMessage?.sessionId || initMessage?.session_id || sessionInfo?.sessionId;
    const sessionId = realSessionId || sessionState.claudeSessionId;
    const projectId = sessionInfo?.projectId || (initMessage?.cwd || sessionState.projectPath || '').replace(/[^a-zA-Z0-9]/g, '-');

    return { sessionId, projectId };
  }, [messagesState.messages, sessionState.claudeSessionId, sessionState.extractedSessionInfo, sessionState.projectPath]);

  useSubagentTranscriptSync({
    sessionId: liveSubagentSessionInfo.sessionId,
    projectId: liveSubagentSessionInfo.projectId,
    enabled: defaultProvider === 'claude',
    active: processState.isLoading,
    subagentProgress: messagesState.subagentProgress,
    setSubagentTranscripts: messagesState.setSubagentTranscripts,
    refreshKey: `${processState.isLoading}:${processState.interactiveSessionId ?? ''}`,
  });

  const activeStreamId = projectChatId
    ? projectChatId
    : streamIdForRuntimeSession(defaultProvider, processState.interactiveSessionId || sessionState.extractedSessionInfo?.runtimeSessionId);

  const frameRuntimeState = useSessionRuntime(activeStreamId);
  const loadingStartedFrameSeqRef = useRef<{ streamId: string | null; seq: number } | null>(null);
  const mergeProjectChatHistory = useCallback(async (chatId: string, shouldMerge: () => boolean = () => true) => {
    const allFrames = await LoadProjectChatHistory(chatId);
    if (!shouldMerge() || !allFrames || !Array.isArray(allFrames) || allFrames.length === 0) return;
    mergeSessionFrames(chatId, allFrames);
  }, []);

  // ProjectChat renders the project chat stream. Provider segments remain a backend detail.
  useEffect(() => {
    if (!projectChatId) return;

    let cancelled = false;
    (async () => {
      try {
        await mergeProjectChatHistory(projectChatId, () => !cancelled);
      } catch (err) {
        console.warn('[SessionController] Failed to load ProjectChat history:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [mergeProjectChatHistory, projectChatId]);

  useEffect(() => {
    if (!projectChatId || !processState.isLoading) return;

    let cancelled = false;
    const backfill = async () => {
      try {
        await mergeProjectChatHistory(projectChatId, () => !cancelled);
      } catch (err) {
        if (!cancelled) {
          console.warn('[SessionController] Failed to backfill ProjectChat history:', err);
        }
      }
    };

    const interval = window.setInterval(backfill, projectChatHistoryBackfillIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [mergeProjectChatHistory, processState.isLoading, projectChatId]);

  const terminalFrameRuntimePhase = frameRuntimeState.runtime?.phase;
  const terminalFrameRuntime =
    terminalFrameRuntimePhase === 'completed' ||
    terminalFrameRuntimePhase === 'failed' ||
    terminalFrameRuntimePhase === 'cancelled';

  if (!processState.isLoading) {
    loadingStartedFrameSeqRef.current = null;
  } else if (!loadingStartedFrameSeqRef.current || loadingStartedFrameSeqRef.current.streamId !== activeStreamId) {
    loadingStartedFrameSeqRef.current = {
      streamId: activeStreamId,
      seq: frameRuntimeState.lastSeq,
    };
  }

  const effectiveLoadingStartedFrameSeq = processState.isLoading
    ? loadingStartedFrameSeqRef.current?.seq ?? frameRuntimeState.lastSeq
    : null;
  const terminalFrameRuntimeIsCurrentTurn =
    terminalFrameRuntime &&
    effectiveLoadingStartedFrameSeq !== null &&
    frameRuntimeState.lastSeq > effectiveLoadingStartedFrameSeq;

  // Session events - depends on all other hooks
  // Note: eventsState sets up event listeners internally, doesn't need to be used explicitly
  useSessionFrameEvents({
    projectPath: sessionState.projectPath,
    claudeSessionId: sessionState.claudeSessionId,
    effectiveSession: sessionState.effectiveSession,
    streamId: activeStreamId,
    provider: defaultProvider,
    isMountedRef,
    setClaudeSessionId: sessionState.setClaudeSessionId,
    setExtractedSessionInfo: sessionState.setExtractedSessionInfo,
    setIsLoading: processState.setIsLoading,
    setIsPendingSend: processState.setIsPendingSend,
    setInteractiveSessionId: processState.setInteractiveSessionId,
    projectPathRef: sessionState.projectPathRef,
    extractedSessionInfoRef: sessionState.extractedSessionInfoRef,
    messagesLengthRef: messagesState.messagesLengthRef,
    isPendingSendRef: processState.isPendingSendRef,
    hasActiveSessionRef: processState.hasActiveSessionRef,
    addMessage: messagesState.addMessage,
    syncProcessState: processState.syncProcessState,
    onComplete: (payload) => {
      const realProviderSessionId = sessionState.extractedSessionInfoRef.current?.sessionId || payload.session_id || null;
      onSessionActivityComplete?.(realProviderSessionId);
      // Trigger title generation after first round completes
      if (firstPromptForTitleRef.current && onSessionTitleGenerated) {
        const promptForTitle = firstPromptForTitleRef.current;
        firstPromptForTitleRef.current = null;
        void generateSessionTitleViaEvent(promptForTitle)
          .then((cleanedTitle: string) => {
            if (cleanedTitle) {
              generatedSessionTitleRef.current = cleanedTitle;
              setGeneratedSessionTitle(cleanedTitle);
              onSessionTitleGenerated(cleanedTitle);
            }
          })
          .catch((err: unknown) => {
            console.warn('[AiCodeSession] Failed to generate session title:', err);
          });
      }
      return refreshCurrentSubagentTranscripts(payload.session_id);
    },
    processNextInQueue: queueState.processNextInQueue,
    trackToolExecution: metricsState.trackToolExecution,
    trackToolFailure: metricsState.trackToolFailure,
    trackFileOperation: metricsState.trackFileOperation,
    trackCodeBlock: metricsState.trackCodeBlock,
    trackError: metricsState.trackError,
    totalTokens: messagesState.totalTokens,
    queuedPromptsLength: queueState.queuedPrompts.length,
    trackEvent,
    workflowTracking,
  });

  useEffect(() => {
    if (processState.isLoading && terminalFrameRuntimeIsCurrentTurn) {
      void processState.syncProcessState();
    }
  }, [processState.isLoading, processState.syncProcessState, terminalFrameRuntimeIsCurrentTurn]);

  // ==================================================================
  // UI STATE (not extracted to hooks - pure UI concerns)
  // ==================================================================

  const [isRecoveringHistory, setIsRecoveringHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSlashCommandsSettings, setShowSlashCommandsSettings] = useState(false);
  const [clearResetEpoch, setClearResetEpoch] = useState(0);
  const previewState = useSessionPreview();
  const [isScrollPaused, setIsScrollPaused] = useState(false);
  // SubagentProgressPanel(s) now manage their own expanded state internally
  // because each session may render multiple panels (one per turn) and they
  // shouldn't share collapsed/expanded state.
  const [expandedSubagentIds, setExpandedSubagentIds] = useState<Set<string>>(new Set());
  const [expandedMessageCards, setExpandedMessageCards] = useState<Set<string>>(new Set());
  const transportStatus = useTransportStatus({
    isLoading: processState.isLoading,
  });
  const stopStatus = useStopStatusFeedback({
    isLoading: processState.isLoading,
    interactiveSessionId: processState.interactiveSessionId,
  });

  useEffect(() => {
    if (!projectChatId) return;

    const off = EventsOn('projectchat:cleared', (event: ProjectChatClearedEvent) => {
      const clearedChatId = event?.chat_id || event?.stream_id;
      if (clearedChatId !== projectChatId) return;
      const clearEventKey = `${clearedChatId}:${event?.segment_id || ''}:${event?.previous_segment_id || ''}`;
      if (lastHandledClearEventRef.current === clearEventKey) return;
      lastHandledClearEventRef.current = clearEventKey;
      if (clearResetQueuedRef.current) return;
      clearResetQueuedRef.current = true;

      writeRendererDiagnostic('projectchat-clear-reset-applied', {
        event,
        projectChatId,
        messageCount: messagesState.messages.length,
        isLoading: processState.isLoading,
        isPendingSend: processState.isPendingSend,
        interactiveSessionId: processState.interactiveSessionId,
        queuedPrompts: queueState.queuedPrompts.length,
      });

      queueMicrotask(() => {
        clearSessionFrames(projectChatId);
        clearSessionRuntime(projectChatId);
        messagesState.clearMessages();
        queueState.clearQueue();
        processState.setIsLoading(false);
        processState.setIsPendingSend(false);
        processState.setInteractiveSessionId(null);
        processState.hasActiveSessionRef.current = false;
        processState.interactiveSessionIdRef.current = null;
        setError(null);
        setExpandedSubagentIds(new Set());
        setExpandedMessageCards(new Set());
        setIsScrollPaused(false);
        streamItemsCountRef.current = 0;
        setStreamItemsCount(0);
        setClearResetEpoch((epoch) => epoch + 1);
        clearResetQueuedRef.current = false;
      });
    });

    return () => {
      off();
    };
  }, [
    messagesState,
    processState,
    projectChatId,
    queueState,
    setError,
  ]);
  const { handleSendPrompt, handleCancelExecution } = useSessionPromptActions({
    defaultProvider,
    projectChatId,
    sessionState,
    messagesState,
    processState,
    metricsState,
    queueState,
    stopStatus,
    firstPromptForTitleRef,
    pendingFreshProviderSessionRef,
    setError,
    refreshCurrentSubagentTranscripts,
    trackEvent,
  });
  sendPromptRef.current = handleSendPrompt;

  // ==================================================================
  // VIRTUOSO for message list
  // ==================================================================

  // Track if user is at the bottom for auto-scroll behavior
  const [, setAtBottom] = useState(true);

  // ==================================================================
  // EFFECTS
  // ==================================================================

  useGeneratedSessionTitlePersistence({
    defaultProvider,
    generatedSessionTitle,
    sessionState,
  });

  // Helper function to scroll to bottom (for manual scroll buttons and history loading)
  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior
    });
  }, []);

  const historyLoader = useSessionHistoryLoader({
    defaultProvider,
    loadedSessionIdRef,
    messagesState,
    processState,
    sessionRef,
    sessionState,
    setError,
    refreshSubagentTranscripts,
    scrollToBottom,
  });

  useSessionControllerLifecycle({
    defaultProvider,
    initialProjectPath,
    session,
    skipSessionRestore,
    loadedSessionIdRef,
    isMountedRef,
    messagesState,
    metricsState,
    processState,
    sessionState,
    historyLoader,
    trackEvent,
    setError,
    onProjectPathChange,
    onStreamingChange,
    onProcessAliveChange,
  });

  useVirtuosoRemeasure(virtuosoRef);

  useSessionRecovery({
    defaultProvider,
    messagesState,
    processState,
    sessionState,
    skipRecoveryUntilRef,
    setIsRecoveringHistory,
    refreshSubagentTranscripts,
    scrollToBottom,
  });

  // ==================================================================
  // HANDLERS
  // ==================================================================

  const currentTodoActiveForm = sessionState.projectPath
    ? getInProgressTodos(sessionState.projectPath)[0]?.activeForm
    : null;

  const runtimeStatusBarModel = useSessionRuntimeStatusModel({
    runtimeTracker,
    isLoading: processState.isLoading,
    interactiveSessionId: processState.interactiveSessionId,
    hasActiveProcess: processState.hasActiveSessionRef.current,
    transportConnected: transportStatus.transportConnected,
    isRecoveringHistory,
    isRestoringSession: processState.isLoading && messagesState.messages.length === 0 && Boolean(sessionState.extractedSessionInfo),
    stopRequested: stopStatus.stopRequestedRef.current || stopStatus.stopStatusBubble.visible,
    lastTransportConnectAt: transportStatus.lastTransportConnectAt,
    loadingStartedAt: processState.loadingStartedAt,
    loadingStartedFrameSeq: effectiveLoadingStartedFrameSeq,
    frameRuntime: frameRuntimeState.runtime,
    frameLastSeq: frameRuntimeState.lastSeq,
    tokenUsage: messagesState.tokenUsage,
    subagentProgress: messagesState.subagentProgress,
    currentTodoActiveForm,
    promptConfig,
    queuedPromptsCount: queueState.queuedPrompts.length,
  });

  const runtimeStatusBar = (
    <RuntimeStatusBar
      model={runtimeStatusBarModel}
      queuedPrompts={queueState.queuedPrompts}
      queueCollapsed={queueState.queuedPromptsCollapsed}
      onQueueCollapsedChange={queueState.setQueuedPromptsCollapsed}
      onRemoveQueuedPrompt={queueState.removeFromQueue}
    />
  );

  useElementSelectionPrompt({
    projectPath: sessionState.projectPath,
    inputRef: floatingPromptRef,
    onSendPrompt: handleSendPrompt,
  });

  const handlePromptConfigChange = useCallback((config: SessionStatusPromptConfig) => {
    setPromptConfig(config);
  }, []);

  // ==================================================================
  // RENDER - Message List
  // ==================================================================

  const followOutput = useCallback((isAtBottom: boolean) => {
    if (isScrollPaused) return false;
    if (!isAtBottom) return false;
    return processState.isLoading ? 'auto' : 'smooth';
  }, [isScrollPaused, processState.isLoading]);

  // streamItems / itemContent / virtuosoComponents now live inside
  // <MessageStreamView />. The view subscribes to messagesState's render
  // tick and recomputes them on every flush, so this parent component stays
  // still during text-delta storms — keeping FloatingPromptInput and the
  // status bar responsive while Claude is streaming.

  const streamItemsCountRef = useRef(0);
  const [streamItemsCount, setStreamItemsCount] = useState(0);
  const atBottomRef = useRef(true);
  const handleStreamItemsCountChange = useCallback((count: number) => {
    if (streamItemsCountRef.current === count) return;
    streamItemsCountRef.current = count;
    setStreamItemsCount(count);
  }, []);
  const handleAtBottomChange = useCallback((isAtBottom: boolean) => {
    if (atBottomRef.current === isAtBottom) return;
    atBottomRef.current = isAtBottom;
    setAtBottom(isAtBottom);
  }, []);

  const messagesList = (
    <SessionMessagePane
      key={clearResetEpoch}
      messagesState={messagesState}
      isLoading={processState.isLoading}
      virtuosoRef={virtuosoRef}
      isScrollPaused={isScrollPaused}
      onScrollPausedChange={setIsScrollPaused}
      streamingViewportIncrease={streamingViewportIncrease}
      idleViewportIncrease={idleViewportIncrease}
      followOutput={followOutput}
      setAtBottom={handleAtBottomChange}
      expandedSubagentIds={expandedSubagentIds}
      setExpandedSubagentIds={setExpandedSubagentIds}
      expandedMessageCards={expandedMessageCards}
      setExpandedMessageCards={setExpandedMessageCards}
      handleLinkDetected={previewState.handleLinkDetected}
      error={error}
      streamItemsCount={streamItemsCount}
      onStreamItemsCountChange={handleStreamItemsCountChange}
      scrollToBottom={scrollToBottom}
    />
  );

  // ==================================================================
  // RENDER - Main Layout
  // ==================================================================

  // If preview is maximized, render only the WebviewPreview in full screen
  if (previewState.showPreview && previewState.isPreviewMaximized) {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-50 bg-background"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <WebviewPreview
            initialUrl={previewState.previewUrl}
            onClose={previewState.handleClosePreview}
            isMaximized={previewState.isPreviewMaximized}
            onToggleMaximize={previewState.handleTogglePreviewMaximize}
            onUrlChange={previewState.handlePreviewUrlChange}
            className="h-full"
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
      <SessionStreamProvider streamId={activeStreamId}>
      <div className={cn("relative flex flex-col h-full bg-background", className)}>
        <div className="w-full h-full flex flex-col">
          <SessionLayoutChrome
            messagesList={messagesList}
            runtimeStatusBar={runtimeStatusBar}
            composerProps={{
              inputRef: floatingPromptRef,
              onSend: handleSendPrompt,
              onCancel: handleCancelExecution,
              stopStatusLabel: stopStatus.stopStatusBubble.label,
              isLoading: processState.isLoading,
              interactiveSessionId: processState.interactiveSessionId,
              disabled: !sessionState.projectPath,
              projectPath: sessionState.projectPath,
              defaultProvider,
              onProviderChange,
              onConfigChange: handlePromptConfigChange,
              onProviderApiHotSwapDuringStream: providerApiSwitchNotice.showNotice,
              extraMenuItems: (
                <CopyConversationMenu
                  messages={messagesState.messages}
                  projectPath={sessionState.projectPath}
                />
              ),
            }}
            providerApiSwitchNotice={providerApiSwitchNotice.notice}
            onDismissProviderApiSwitchNotice={providerApiSwitchNotice.dismissNotice}
            showPreview={previewState.showPreview}
            previewUrl={previewState.previewUrl}
            splitPosition={previewState.splitPosition}
            onSplitPositionChange={previewState.setSplitPosition}
            isPreviewMaximized={previewState.isPreviewMaximized}
            onClosePreview={previewState.handleClosePreview}
            onTogglePreviewMaximize={previewState.handleTogglePreviewMaximize}
            onPreviewUrlChange={previewState.handlePreviewUrlChange}
            showSlashCommandsSettings={showSlashCommandsSettings}
            onSlashCommandsSettingsOpenChange={setShowSlashCommandsSettings}
            projectPath={sessionState.projectPath}
          />
        </div>
      </div>
      </SessionStreamProvider>
  );
};
