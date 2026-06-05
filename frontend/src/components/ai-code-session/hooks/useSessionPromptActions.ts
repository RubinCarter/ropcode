import { useCallback } from "react";
import { ClearProjectChat, InterruptProjectChat, SendProjectChatMessage } from "@/lib/rpc-client";
import { maybeWrapFirstMessage } from "@/lib/worktreeHelper";
import { writeRendererDiagnostic } from "@/lib/rendererDiagnostics";
import { resetRuntimeTracker } from "../state/runtimeTrackerStore";
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
}

export interface UseSessionPromptActionsOptions {
  defaultProvider: string;
  projectChatId?: string;
  sessionState: UseSessionStateReturn;
  messagesState: UseSessionMessagesReturn;
  processState: UseProcessStateReturn;
  metricsState: UseSessionMetricsReturn;
  queueState: UsePromptQueueReturn;
  stopStatus: UseStopStatusFeedbackReturn;
  firstPromptForTitleRef: React.MutableRefObject<string | null>;
  pendingFreshProviderSessionRef: React.MutableRefObject<boolean>;
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
  ) => Promise<boolean>;
  handleCancelExecution: () => Promise<void>;
}

export function useSessionPromptActions({
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
}: UseSessionPromptActionsOptions): UseSessionPromptActionsReturn {
  const handleBackendClear = useCallback(async () => {
    if (!projectChatId) {
      throw new Error("ProjectChat is not available for this session");
    }

    await ClearProjectChat(projectChatId);
  }, [projectChatId]);

  const handleSendPrompt = useCallback(async (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    provider?: string,
  ): Promise<boolean> => {
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
    });

    if (classification.action === 'ignore') {
      return false;
    }

    if (classification.action === 'reject') {
      setError("Please select a project directory first");
      return false;
    }

    if (classification.action === 'backend-clear') {
      await handleBackendClear();
      return true;
    }

    if (classification.action === 'enqueue') {
      queueState.addToQueue(prompt, model, providerApiId, thinkingMode, activeProvider);
      return true;
    }

    try {
      processState.setIsLoading(true);
      processState.setIsPendingSend(true);
      setError(null);
      resetRuntimeTracker(sessionState.projectPath);
      processState.hasActiveSessionRef.current = true;

      pendingFreshProviderSessionRef.current = false;

      if (!projectChatId) {
        throw new Error("ProjectChat is not available for this session");
      }

      // Ensure session ID
      if (sessionState.effectiveSession && !sessionState.claudeSessionId) {
        sessionState.setClaudeSessionId(sessionState.effectiveSession.id);
      }

      const wrappedPrompt = await maybeWrapFirstMessage(
        sessionState.projectPath,
        prompt,
        sessionState.isFirstPrompt
      );

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

      trackEvent.modelSelected(model);
      const runtimeSessionId = await SendProjectChatMessage(projectChatId, wrappedPrompt, model, providerApiId || undefined, thinkingMode);
      writeRendererDiagnostic('projectchat-send-runtime', {
        projectChatId,
        provider: activeProvider,
        model,
        runtimeSessionId,
        streamId: projectChatId,
      });
      if (runtimeSessionId) {
        processState.setInteractiveSessionId(runtimeSessionId);
        processState.interactiveSessionIdRef.current = runtimeSessionId;
      }

      // Clear pending flag after init message arrives
      setTimeout(() => {
        processState.setIsPendingSend(false);
      }, 500);

      return true;
    } catch (err) {
      console.error('[AiCodeSession] Failed to send prompt:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      writeRendererDiagnostic('projectchat-send-failed', {
        projectChatId,
        provider: activeProvider,
        model,
        error: errorMessage,
      });
      setError(`Failed to send prompt: ${errorMessage}`);
      processState.setIsLoading(false);
      processState.setIsPendingSend(false);
      processState.hasActiveSessionRef.current = false;
      return false;
    }
  }, [
    defaultProvider,
    firstPromptForTitleRef,
    handleBackendClear,
    messagesState,
    metricsState,
    pendingFreshProviderSessionRef,
    processState,
    projectChatId,
    queueState,
    sessionState,
    setError,
    trackEvent,
  ]);

  const handleCancelExecution = useCallback(async () => {
    stopStatus.stopRequestedRef.current = true;
    stopStatus.showStopStatusBubble();
    const runtimeSessionId = processState.interactiveSessionIdRef.current || processState.interactiveSessionId;
    const canCancel = Boolean(sessionState.projectPath && (processState.isLoading || runtimeSessionId));
    if (!canCancel) return;

    try {
      const sessionStartTimeValue = messagesState.messages.length > 0 ? messagesState.messages[0].timestamp || Date.now() : Date.now();
      const duration = Date.now() - sessionStartTimeValue;

      if (!projectChatId) {
        throw new Error("ProjectChat is not available for this session");
      }
      await InterruptProjectChat(projectChatId);
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

      const keepRuntimeSession = Boolean(projectChatId && runtimeSessionId);
      processState.setIsLoading(false);
      processState.hasActiveSessionRef.current = keepRuntimeSession;
      processState.setInteractiveSessionId(keepRuntimeSession ? runtimeSessionId : null);
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
      const runtimeSessionId = processState.interactiveSessionIdRef.current || processState.interactiveSessionId;
      const keepRuntimeSession = Boolean(projectChatId && runtimeSessionId);
      processState.hasActiveSessionRef.current = keepRuntimeSession;
      processState.setInteractiveSessionId(keepRuntimeSession ? runtimeSessionId : null);
      setError(null);
      stopStatus.stopRequestedRef.current = false;
      stopStatus.completeStopStatusBubble();
    }
  }, [
    messagesState,
    metricsState,
    processState,
    projectChatId,
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
