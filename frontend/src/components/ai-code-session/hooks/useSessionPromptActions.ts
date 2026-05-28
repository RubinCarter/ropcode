import { useCallback } from "react";
import { api } from "@/lib/api";
import { SendProjectChatMessage, CreateProjectChat } from "@/lib/rpc-client";
import { maybeWrapFirstMessage } from "@/lib/worktreeHelper";
import { resetRuntimeTracker } from "../state/runtimeTrackerStore";
import { getLocalClearMessage, shouldShowStopFeedbackOnLocalClear } from "../utils/clearCommand";
import { classifyPromptSubmit } from "../utils/promptSubmitClassification";
import type { ClaudeStreamMessage } from "../types";
import type { UseProcessStateReturn } from "./useProcessState";
import type { UsePromptQueueReturn } from "./usePromptQueue";
import type { UseSessionMessagesReturn } from "./useSessionMessages";
import type { UseSessionMetricsReturn } from "./useSessionMetrics";
import type { UseSessionStateReturn } from "./useSessionState";
import type { UseStopStatusFeedbackReturn } from "./useStopStatusFeedback";

interface SessionPromptActionsTracking {
  enhancedPromptSubmitted: (payload: any) => void;
  enhancedSessionStopped: (payload: any) => void;
  modelSelected: (model: string) => void;
  sessionCreated: (model: string, source: string) => void;
  sessionResumed: (sessionId: string) => void;
}

export interface UseSessionPromptActionsOptions {
  defaultProvider: string;
  projectChatId?: string;
  onProjectChatCreated?: (chatId: string, streamId: string) => void;
  sessionState: UseSessionStateReturn;
  messagesState: UseSessionMessagesReturn;
  processState: UseProcessStateReturn;
  metricsState: UseSessionMetricsReturn;
  queueState: UsePromptQueueReturn;
  stopStatus: UseStopStatusFeedbackReturn;
  firstPromptForTitleRef: React.MutableRefObject<string | null>;
  loadedSessionIdRef: React.MutableRefObject<string | null>;
  pendingFreshClaudeSessionRef: React.MutableRefObject<boolean>;
  skipRecoveryUntilRef: React.MutableRefObject<number>;
  setError: (error: string | null) => void;
  refreshCurrentSubagentTranscripts: (sessionIdOverride?: string | null) => Promise<void>;
  trackEvent: SessionPromptActionsTracking;
}

export interface UseSessionPromptActionsReturn {
  handleSendPrompt: (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    provider?: string,
    options?: { forceFreshClaudeSession?: boolean },
  ) => Promise<boolean>;
  handleCancelExecution: () => Promise<void>;
}

export function useSessionPromptActions({
  defaultProvider,
  projectChatId,
  onProjectChatCreated,
  sessionState,
  messagesState,
  processState,
  metricsState,
  queueState,
  stopStatus,
  firstPromptForTitleRef,
  loadedSessionIdRef,
  pendingFreshClaudeSessionRef,
  skipRecoveryUntilRef,
  setError,
  refreshCurrentSubagentTranscripts,
  trackEvent,
}: UseSessionPromptActionsOptions): UseSessionPromptActionsReturn {
  const handleLocalClearFallback = useCallback(async () => {
    console.log('[AiCodeSession] Clearing local conversation fallback');

    const shouldShowStopFeedback = shouldShowStopFeedbackOnLocalClear({
      provider: defaultProvider,
      isLoading: processState.isLoading,
      interactiveSessionId: processState.interactiveSessionId,
    });

    if (shouldShowStopFeedback) {
      stopStatus.stopRequestedRef.current = true;
      stopStatus.showStopStatusBubble();
      skipRecoveryUntilRef.current = Date.now() + 5000;
    } else {
      stopStatus.stopRequestedRef.current = false;
    }

    if (defaultProvider === 'claude' && processState.interactiveSessionId) {
      try {
        await api.cancelClaudeExecutionByProject(sessionState.projectPath);
      } catch (err) {
        console.error('[AiCodeSession] Failed to stop Claude session during clear:', err);
      }
    }

    pendingFreshClaudeSessionRef.current = defaultProvider === 'claude';
    messagesState.clearMessages();
    sessionState.setClaudeSessionId(null);
    sessionState.setExtractedSessionInfo(null);
    sessionState.setIsFirstPrompt(true);
    metricsState.resetMetrics();
    setError(null);
    processState.setInteractiveSessionId(null);
    processState.hasActiveSessionRef.current = false;
    queueState.clearQueue();

    const clearMessage: ClaudeStreamMessage = {
      type: "system",
      subtype: "info",
      message: {
        content: [{ type: "text", text: getLocalClearMessage({ provider: defaultProvider, didStopSession: shouldShowStopFeedback }) }]
      }
    };
    messagesState.addMessage(clearMessage);
  }, [
    defaultProvider,
    messagesState,
    metricsState,
    pendingFreshClaudeSessionRef,
    processState,
    queueState,
    sessionState,
    setError,
    skipRecoveryUntilRef,
    stopStatus,
  ]);

  const handleSendPrompt = useCallback(async (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    provider?: string,
    options?: { forceFreshClaudeSession?: boolean }
  ): Promise<boolean> => {
    console.log('[AiCodeSession] Sending prompt with thinkingMode:', thinkingMode);
    const activeProvider = provider || defaultProvider;
    // Store first prompt for title generation after first round completes
    if (sessionState.isFirstPrompt && prompt.trim().length > 0) {
      firstPromptForTitleRef.current = prompt;
    }

    const classification = classifyPromptSubmit({
      prompt,
      provider: activeProvider,
      hasProjectPath: Boolean(sessionState.projectPath),
      isLoading: processState.isLoading,
      hasInteractiveSession: Boolean(processState.interactiveSessionIdRef.current),
      forceFreshSession: options?.forceFreshClaudeSession,
    });

    if (classification.action === 'ignore') {
      return false;
    }

    if (classification.action === 'reject') {
      setError("Please select a project directory first");
      return false;
    }

    if (classification.action === 'local-clear') {
      await handleLocalClearFallback();
      return true;
    }

    if (classification.action === 'enqueue') {
      console.log('[AiCodeSession] Session busy (batch mode), queueing prompt');
      queueState.addToQueue(prompt, model, providerApiId, thinkingMode, activeProvider);
      return true;
    }

    try {
      processState.setIsLoading(true);
      processState.setIsPendingSend(true);
      setError(null);
      resetRuntimeTracker(sessionState.projectPath);
      processState.hasActiveSessionRef.current = true;

      const forceFreshClaudeSession =
        options?.forceFreshClaudeSession === true ||
        (activeProvider === 'claude' && pendingFreshClaudeSessionRef.current);
      pendingFreshClaudeSessionRef.current = false;

      if (forceFreshClaudeSession) {
        loadedSessionIdRef.current = null;
        processState.setInteractiveSessionId(null);
        processState.hasActiveSessionRef.current = false;
        queueState.clearQueue();
      }

      // Ensure session ID
      if (sessionState.effectiveSession && !sessionState.claudeSessionId) {
        sessionState.setClaudeSessionId(sessionState.effectiveSession.id);
      }

      const shouldWrapPrompt = !(activeProvider === 'claude' && prompt.trim() === '/clear');
      const wrappedPrompt = shouldWrapPrompt
        ? await maybeWrapFirstMessage(
            sessionState.projectPath,
            prompt,
            sessionState.isFirstPrompt
          )
        : prompt;

      // Add user message to UI
      const userMessage: ClaudeStreamMessage = {
        type: "user",
        timestamp: new Date().toISOString(),
        message: {
          content: [{ type: "text", text: prompt }]
        }
      };
      messagesState.addMessage(userMessage);

      // Track metrics
      metricsState.trackPromptSent(model);

      // Track analytics
      const wordCount = prompt.split(/\s+/).filter(word => word.length > 0).length;
      const codeBlockMatches = prompt.match(/```[\s\S]*?```/g) || [];
      const hasCode = codeBlockMatches.length > 0;

      trackEvent.enhancedPromptSubmitted({
        prompt_length: prompt.length,
        model: model,
        has_attachments: false,
        source: 'keyboard',
        word_count: wordCount,
        conversation_depth: messagesState.messages.filter(m => m.user_message).length,
        prompt_complexity: wordCount < 20 ? 'simple' : wordCount < 100 ? 'moderate' : 'complex',
        contains_code: hasCode,
        language_detected: hasCode ? codeBlockMatches?.[0]?.match(/```(\w+)/)?.[1] : undefined,
        session_age_ms: Date.now() - metricsState.sessionStartTime.current
      });

      // Execute command
      // Different logic for Claude (interactive) vs other providers (batch)
      // Use ref to get latest value, avoiding stale closures in queued callbacks
      const currentInteractiveSessionId = processState.interactiveSessionIdRef.current;
      const currentEffectiveSession = sessionState.effectiveSession;

      // ProjectChat mode: route through virtual session
      // Auto-create ProjectChat on first send if not exists
      let activeChatId = projectChatId;
      if (!activeChatId && sessionState.projectPath) {
        try {
          const chat = await CreateProjectChat(
            sessionState.projectPath, activeProvider, model, providerApiId || '', currentInteractiveSessionId || ''
          );
          activeChatId = chat.chat_id;
          onProjectChatCreated?.(chat.chat_id, chat.stream_id);
        } catch (err) {
          console.warn('[AiCodeSession] Failed to auto-create ProjectChat, using legacy path:', err);
        }
      }

      if (activeChatId) {
        console.log('[AiCodeSession] Sending via ProjectChat:', activeChatId);
        trackEvent.modelSelected(model);
        await SendProjectChatMessage(activeChatId, wrappedPrompt, model, providerApiId || undefined, thinkingMode);
      } else if (currentInteractiveSessionId) {
        // Interactive session is alive (real-time state), send message directly
        console.log('[AiCodeSession] Sending to active interactive session:', currentInteractiveSessionId);
        trackEvent.sessionResumed(currentInteractiveSessionId);
        trackEvent.modelSelected(model);

        if (activeProvider === 'claude') {
          await api.SendClaudeMessage(sessionState.projectPath, currentInteractiveSessionId, wrappedPrompt);
        } else {
          const runtimeSessionId = await api.resumeProviderSession(activeProvider, sessionState.projectPath, wrappedPrompt, model, currentInteractiveSessionId, providerApiId || undefined, thinkingMode);
          processState.setInteractiveSessionId(runtimeSessionId);
        }
      } else if (currentEffectiveSession && !sessionState.isFirstPrompt && activeProvider !== 'claude') {
        // For non-Claude providers (batch mode), can safely resume from effectiveSession
        console.log('[AiCodeSession] Resuming batch mode session');
        trackEvent.sessionResumed(currentEffectiveSession.id);
        trackEvent.modelSelected(model);

        const runtimeSessionId = await api.resumeProviderSession(activeProvider, sessionState.projectPath, wrappedPrompt, model, currentEffectiveSession.id, providerApiId || undefined, thinkingMode);
        processState.setInteractiveSessionId(runtimeSessionId);
      } else {
        // Start new session:
        // - For Claude: always start new if no interactiveSessionId
        // - For others: start new if no effectiveSession or isFirstPrompt
        console.log('[AiCodeSession] Starting new session');
        sessionState.setIsFirstPrompt(false);
        trackEvent.sessionCreated(model, 'prompt_input');
        trackEvent.modelSelected(model);

        if (activeProvider === 'claude') {
          // Interactive mode: start long-lived process, then send first message.
          // Pass the persisted Claude session ID (from effectiveSession) so the
          // CLI can resume the conversation with --resume <id> after a stop or restart.
          const resumeId = forceFreshClaudeSession
            ? '__ROP_FRESH_SESSION__'
            : (!sessionState.isFirstPrompt ? (sessionState.effectiveSession?.id ?? '') : '');
          const interactiveSessionId = await api.StartInteractiveClaudeSession(
            sessionState.projectPath, model, providerApiId || undefined, resumeId
          );
          // Save interactive session ID immediately so subsequent messages bypass the queue
          processState.setInteractiveSessionId(interactiveSessionId);
          // Send the first message
          await api.SendClaudeMessage(sessionState.projectPath, interactiveSessionId, wrappedPrompt);
        } else {
          const runtimeSessionId = await api.startProviderSession(activeProvider, sessionState.projectPath, wrappedPrompt, model, providerApiId, thinkingMode);
          processState.setInteractiveSessionId(runtimeSessionId);
        }
      }

      // Clear pending flag after init message arrives
      setTimeout(() => {
        processState.setIsPendingSend(false);
        console.log('[AiCodeSession] isPendingSend cleared');
      }, 500);

      return true;
    } catch (err) {
      console.error('[AiCodeSession] Failed to send prompt:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to send prompt: ${errorMessage}`);
      processState.setIsLoading(false);
      processState.setIsPendingSend(false);
      processState.hasActiveSessionRef.current = false;
      return false;
    }
  }, [
    defaultProvider,
    firstPromptForTitleRef,
    handleLocalClearFallback,
    loadedSessionIdRef,
    messagesState,
    metricsState,
    pendingFreshClaudeSessionRef,
    processState,
    queueState,
    sessionState,
    setError,
    trackEvent,
  ]);

  const handleCancelExecution = useCallback(async () => {
    stopStatus.stopRequestedRef.current = true;
    stopStatus.showStopStatusBubble();
    // Allow cancellation if either loading or interactive session is active
    if (!sessionState.projectPath || (!processState.isLoading && !processState.interactiveSessionId)) return;

    try {
      const sessionStartTimeValue = messagesState.messages.length > 0 ? messagesState.messages[0].timestamp || Date.now() : Date.now();
      const duration = Date.now() - sessionStartTimeValue;

      await api.cancelClaudeExecutionByProject(sessionState.projectPath);
      await processState.syncProcessState();

      // Track enhanced session stopped
      const metrics = metricsState.sessionMetrics.current;
      const timeToFirstMessage = metrics.firstMessageTime
        ? metrics.firstMessageTime - metricsState.sessionStartTime.current
        : undefined;
      const idleTime = Date.now() - metrics.lastActivityTime;
      const avgResponseTime = metrics.toolExecutionTimes.length > 0
        ? metrics.toolExecutionTimes.reduce((a, b) => a + b, 0) / metrics.toolExecutionTimes.length
        : undefined;

      trackEvent.enhancedSessionStopped({
        duration_ms: duration,
        messages_count: messagesState.messages.length,
        reason: 'user_stopped',
        time_to_first_message_ms: timeToFirstMessage,
        average_response_time_ms: avgResponseTime,
        idle_time_ms: idleTime,
        prompts_sent: metrics.promptsSent,
        tools_executed: metrics.toolsExecuted,
        tools_failed: metrics.toolsFailed,
        files_created: metrics.filesCreated,
        files_modified: metrics.filesModified,
        files_deleted: metrics.filesDeleted,
        total_tokens_used: messagesState.totalTokens,
        code_blocks_generated: metrics.codeBlocksGenerated,
        errors_encountered: metrics.errorsEncountered,
        model: metrics.modelChanges.length > 0
          ? metrics.modelChanges[metrics.modelChanges.length - 1].to
          : 'sonnet',
        was_resumed: metrics.wasResumed,
        agent_type: undefined,
        agent_name: undefined,
        agent_success: undefined,
        stop_source: 'user_button',
        final_state: 'cancelled',
        has_pending_prompts: queueState.queuedPrompts.length > 0,
        pending_prompts_count: queueState.queuedPrompts.length,
        has_checkpoints: false,
      });

      processState.setIsLoading(false);
      processState.hasActiveSessionRef.current = false;
      processState.setInteractiveSessionId(null);  // Clear interactive session
      setError(null);
      queueState.clearQueue();

      const cancelMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "info",
        result: "Session cancelled by user",
        timestamp: new Date().toISOString()
      };
      messagesState.addMessage(cancelMessage);
      void refreshCurrentSubagentTranscripts();
    } catch (err) {
      console.error("Failed to cancel execution:", err);

      const errorMessage: ClaudeStreamMessage = {
        type: "system",
        subtype: "error",
        result: `Failed to cancel execution: ${err instanceof Error ? err.message : 'Unknown error'}. The process may still be running in the background.`,
        timestamp: new Date().toISOString()
      };
      messagesState.addMessage(errorMessage);

      processState.setIsLoading(false);
      processState.hasActiveSessionRef.current = false;
      processState.setInteractiveSessionId(null);  // Clear interactive session
      setError(null);
      stopStatus.stopRequestedRef.current = false;
      stopStatus.completeStopStatusBubble();
    }
  }, [
    messagesState,
    metricsState,
    processState,
    queueState,
    refreshCurrentSubagentTranscripts,
    sessionState.projectPath,
    setError,
    stopStatus,
    trackEvent,
  ]);

  return {
    handleSendPrompt,
    handleCancelExecution,
  };
}
