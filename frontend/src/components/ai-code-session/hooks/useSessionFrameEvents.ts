/**
 * Session event handling hook
 *
 * Manages browser event listeners and stream message processing
 * This is the most complex part - handle with care!
 */

import { useEffect, useCallback, useRef } from "react";
import type { ClaudeStreamMessage, Session, SessionInfo, SessionRuntimeTracker } from "../types";
import { api } from "@/lib/api";
import { SessionPersistenceService } from "@/services/sessionPersistence";
import { useWorkspaceTodo, type TodoItem } from "@/contexts/WorkspaceTodoContext";
import {
  applyRuntimeMessage,
  enqueueRuntimeMessage,
  flushRuntimeMessages,
  resetRuntimeTracker,
} from "../state/runtimeTrackerStore";
import { clearInteractiveSessionIdAfterProcessExit } from "../utils/interactiveSessionState";
import { useSessionFrameMessages } from "@/hooks/useSessionFrameMessages";
import { EventsOn } from "@/lib/rpc-events";
import { useProcessChanged } from "@/hooks/useEventSubscription";

export interface UseSessionFrameEventsOptions {
  projectPath: string;
  claudeSessionId: string | null;
  effectiveSession: Session | null;
  streamId?: string | null;
  provider?: string;  // Provider ID (claude, codex, etc.)
  isMountedRef: React.MutableRefObject<boolean>;

  // State setters
  setClaudeSessionId: (id: string | null) => void;
  setExtractedSessionInfo: (info: SessionInfo | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsPendingSend: (pending: boolean) => void;
  setInteractiveSessionId: (id: string | null) => void;
  /**
   * @deprecated Runtime tracker now lives in `runtimeTrackerStore`. Pass
   * undefined to opt into the store-driven path; the parameter is kept for
   * the old `useState` callsite while the migration finishes.
   */
  setRuntimeTracker?: React.Dispatch<React.SetStateAction<SessionRuntimeTracker>>;

  // Refs for stable access
  projectPathRef: React.MutableRefObject<string>;
  extractedSessionInfoRef: React.MutableRefObject<SessionInfo | null>;
  messagesLengthRef: React.MutableRefObject<number>;
  isPendingSendRef: React.MutableRefObject<boolean>;
  hasActiveSessionRef: React.MutableRefObject<boolean>;

  // Callbacks
  addMessage: (message: ClaudeStreamMessage) => void;
  syncProcessState: () => Promise<void>;
  onComplete?: (payload: ClaudeCompletionPayload) => void | Promise<void>;

  // Metrics tracking
  trackToolExecution: (toolName: string) => void;
  trackToolFailure: () => void;
  trackFileOperation: (operation: 'create' | 'modify' | 'delete') => void;
  trackCodeBlock: () => void;
  trackError: () => void;

  // Queue processing
  processNextInQueue: () => void;

  // Other dependencies
  totalTokens: number;
  queuedPromptsLength: number;

  // Analytics
  trackEvent: any;
  workflowTracking: any;
}

interface ClaudeCompletionPayload {
  success: boolean;
  status?: string;
  session_id?: string;
  cwd?: string;
  provider?: string;
  exit_code?: number;
  exitCode?: number;
  timestamp?: string;
  runtime?: unknown;
  debug_meta?: {
    runtime_state?: unknown;
  };
}

export interface UseSessionFrameEventsReturn {
  handleStreamMessage: (payload: string) => void;
  processComplete: (completion: boolean | string | ClaudeCompletionPayload) => Promise<void>;
}

function countCodeFencePairs(text: string): number {
  let count = 0;
  let index = text.indexOf('```');
  while (index !== -1) {
    count++;
    index = text.indexOf('```', index + 3);
  }
  return Math.floor(count / 2);
}

function isTextDeltaMessage(message: ClaudeStreamMessage): boolean {
  if (message.type !== 'assistant' || (message as any).is_delta !== true) return false;
  if ((message as any).message?.stop_reason === 'end_turn' || (message as any).stop_reason === 'end_turn') return false;
  const content = message.message?.content;
  if (!Array.isArray(content)) return false;
  return content.every((block: any) => block?.type === 'text');
}

export function coerceCompletionPayload(completion: boolean | string | ClaudeCompletionPayload): ClaudeCompletionPayload {
  if (typeof completion === 'boolean') {
    return { success: completion, status: completion ? 'completed' : 'failed' };
  }

  if (typeof completion === 'string') {
    if (completion === 'true' || completion === 'false') {
      const success = completion === 'true';
      return { success, status: success ? 'completed' : 'failed' };
    }

    try {
      return coerceCompletionPayload(JSON.parse(completion) as ClaudeCompletionPayload);
    } catch (_err) {
      return { success: false, status: 'failed' };
    }
  }

  const exitCode = completion.exit_code ?? completion.exitCode;
  const hasExplicitSuccess = typeof completion.success === 'boolean';
  const success = hasExplicitSuccess ? completion.success : (typeof exitCode === 'number' ? exitCode === 0 : false);

  return {
    ...completion,
    success,
    status: completion.status || (success ? 'completed' : 'failed'),
  };
}

function parseCompletionPayload(payload: unknown): ClaudeCompletionPayload | null {
  if (typeof payload === 'boolean' || typeof payload === 'string') {
    return coerceCompletionPayload(payload);
  }
  if (payload && typeof payload === 'object') {
    return coerceCompletionPayload(payload as ClaudeCompletionPayload);
  }
  return null;
}

function parseEventObject(payload: unknown): Record<string, any> | null {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as Record<string, any>;
    } catch {
      return null;
    }
  }
  if (payload && typeof payload === 'object') {
    return payload as Record<string, any>;
  }
  return null;
}

/**
 * Hook to manage session events
 */
export function useSessionFrameEvents(options: UseSessionFrameEventsOptions): UseSessionFrameEventsReturn {
  const {
    projectPath,
    claudeSessionId,
    streamId,
    isMountedRef,
    setClaudeSessionId,
    setExtractedSessionInfo,
    setIsLoading,
    setInteractiveSessionId,
    // setRuntimeTracker is now ignored — runtime state lives in
    // runtimeTrackerStore. The option is kept on the interface so the old
    // useState callsite can be migrated lazily.
    projectPathRef,
    extractedSessionInfoRef,
    messagesLengthRef,
    isPendingSendRef,
    hasActiveSessionRef,
    addMessage,
    onComplete,
    processNextInQueue,
    trackToolExecution,
    trackToolFailure,
    trackFileOperation,
    trackCodeBlock,
    trackError,
    trackEvent,
    workflowTracking,
  } = options;

  const { updateWorkspaceTodos, setWorkspaceStatus } = useWorkspaceTodo();
  // Runtime tracker is now owned by `runtimeTrackerStore`; this hook only
  // forwards messages and triggers flushes by projectPath. The local
  // pending/raf state previously held here moved into the store so multiple
  // listeners share a single coalesce window.
  const pendingSessionSaveRef = useRef<{
    sessionId: string;
    projectId: string;
    projectPath: string;
    provider: string;
    messageCount: number;
  } | null>(null);
  const sessionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRuntimeSessionsRef = useRef<Set<string>>(new Set());

  const flushRuntimeTracker = useCallback(() => {
    flushRuntimeMessages(projectPath);
  }, [projectPath]);

  const enqueueRuntimeTrackerUpdate = useCallback((message: ClaudeStreamMessage) => {
    if (!projectPath) return;
    enqueueRuntimeMessage(projectPath, message);
  }, [projectPath]);

  const flushPendingSessionSave = useCallback(() => {
    if (sessionSaveTimeoutRef.current !== null) {
      clearTimeout(sessionSaveTimeoutRef.current);
      sessionSaveTimeoutRef.current = null;
    }

    const pendingSave = pendingSessionSaveRef.current;
    if (!pendingSave) return;
    pendingSessionSaveRef.current = null;
    SessionPersistenceService.saveSession(
      pendingSave.sessionId,
      pendingSave.projectId,
      pendingSave.projectPath,
      pendingSave.provider,
      pendingSave.messageCount
    );
  }, []);

  const scheduleSessionSave = useCallback((provider: string) => {
    const sessionInfo = extractedSessionInfoRef.current;
    if (!sessionInfo) return;

    pendingSessionSaveRef.current = {
      sessionId: sessionInfo.sessionId,
      projectId: sessionInfo.projectId,
      projectPath: projectPathRef.current,
      provider,
      messageCount: messagesLengthRef.current + 1,
    };

    if (sessionSaveTimeoutRef.current === null) {
      sessionSaveTimeoutRef.current = setTimeout(flushPendingSessionSave, 750);
    }
  }, [extractedSessionInfoRef, flushPendingSessionSave, messagesLengthRef, projectPathRef]);

  useEffect(() => {
    if (projectPath) {
      resetRuntimeTracker(projectPath);
    }
  }, [projectPath]);

  useEffect(() => () => {
    flushRuntimeTracker();
    flushPendingSessionSave();
  }, [flushRuntimeTracker, flushPendingSessionSave]);

  /**
   * Handle stream message from backend
   */
  const handleStreamMessage = useCallback((payload: string) => {
    try {
      // Don't process if component unmounted
      if (!isMountedRef.current) {
        return;
      }

      const message = JSON.parse(payload) as ClaudeStreamMessage;
      const provider = (message as any).provider || options.provider || 'claude';

      enqueueRuntimeTrackerUpdate(message);

      if (isTextDeltaMessage(message)) {
        addMessage(message);
        return;
      }

      // Extract and save session info from init messages
      if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
        const oldSessionId = claudeSessionId;
        const runtimeSessionId = (message as any).runtime_session_id || message.session_id;
        setClaudeSessionId(runtimeSessionId);

        // Set workspace status to 'working' when session starts
        if (projectPath) {
          setWorkspaceStatus(projectPath, 'working');
        }

        // Session ID tracking removed — UpdateProviderSession was a no-op

        // If this is a new session, sync state immediately
        // But in interactive mode, don't override isLoading from process state
        if (!oldSessionId || runtimeSessionId !== oldSessionId) {
          const currentProjectPath = projectPathRef.current;
          if (currentProjectPath) {
            setTimeout(() => {
              // Don't sync if we're pending a send
              if (isPendingSendRef.current) {
                return;
              }

              api.isClaudeSessionRunningForProject(currentProjectPath, runtimeSessionId).then((running: boolean) => {
                hasActiveSessionRef.current = running;
                // In interactive mode, isLoading is controlled by message flow,
                // not by process running state. The process is always running.
                // Only set isLoading from process state for batch mode.
                // For init messages, isLoading should already be true (set when sending).
              }).catch((err: unknown) => {
                console.error('[useSessionFrameEvents] Failed to sync state:', err);
              });
            }, 50);
          }
        }

        // Update extractedSessionInfo
        // In interactive mode, prefer claude_session_id (the real Claude session ID) for
        // persistence so it can be used with --resume on app restart. The session_id field
        // in interactive mode is the Go UUID which is meaningless after restart.
        const realClaudeSessionId = (message as any).claude_session_id || (message as any).sessionId || message.session_id;
        const persistSessionId = realClaudeSessionId;
        const projectId = projectPathRef.current.replace(/[^a-zA-Z0-9]/g, '-');
        if (!extractedSessionInfoRef.current || extractedSessionInfoRef.current.sessionId !== persistSessionId) {
          setExtractedSessionInfo({
            sessionId: persistSessionId,
            projectId,
            runtimeSessionId,
            claudeSessionId: realClaudeSessionId,
          });
          SessionPersistenceService.saveSession(
            persistSessionId,
            projectId,
            projectPathRef.current,
            provider,
            messagesLengthRef.current
          );
        }
      }

      if (Array.isArray(message.message?.content)) {
        for (const block of message.message.content as any[]) {
          if (message.type === 'assistant') {
            if (block.type === 'tool_use') {
              trackToolExecution(block.name);

              const toolName = block.name?.toLowerCase() || '';
              if (toolName.includes('create') || toolName.includes('write')) {
                trackFileOperation('create');
              } else if (toolName.includes('edit') || toolName.includes('multiedit') || toolName.includes('search_replace')) {
                trackFileOperation('modify');
              } else if (toolName.includes('delete')) {
                trackFileOperation('delete');
              }

              workflowTracking.trackStep(block.name);

              if (block.name === 'TodoWrite' && block.input?.todos) {
                try {
                  const todos = block.input.todos as TodoItem[];
                  if (projectPath) {
                    updateWorkspaceTodos(projectPath, projectPath, todos);
                  }
                } catch (err) {
                  console.error('[useSessionFrameEvents] Failed to parse TodoWrite:', err);
                }
              }
            } else if (block.type === 'text' && block.text?.includes('```')) {
              const blockCount = countCodeFencePairs(block.text);
              for (let i = 0; i < blockCount; i++) {
                trackCodeBlock();
              }
            }
          } else if (message.type === 'user' && block.type === 'tool_result' && block.is_error) {
            trackToolFailure();
            trackEvent.enhancedError({
              error_type: 'tool_execution',
              error_code: 'tool_failed',
              error_message: block.content,
              context: 'Tool execution failed',
              user_action_before_error: 'executing_tool',
              recovery_attempted: false,
              recovery_successful: false,
              error_frequency: 1,
              stack_trace_hash: undefined
            });
          }
        }
      }

      // Track errors in system messages
      if (message.type === 'system' && (message.subtype === 'error' || message.error)) {
        trackError();
      }

      const isAssistantEndTurn = message.type === 'assistant' &&
        ((message as any).message?.stop_reason === 'end_turn' || (message as any).stop_reason === 'end_turn');

      // Handle terminal turn messages. Interactive Claude streams may finish a
      // turn with assistant/end_turn instead of a separate result message.
      if (message.type === 'result' || isAssistantEndTurn) {
        flushRuntimeTracker();
        flushPendingSessionSave();
        const runtimeSessionId = (message as any).runtime_session_id || message.session_id;
        const completionSessionId = runtimeSessionId ||
          extractedSessionInfoRef.current?.runtimeSessionId ||
          claudeSessionId ||
          undefined;
        void onComplete?.({
          success: !(message as any).is_error,
          status: isAssistantEndTurn ? 'completed' : ((message as any).is_error ? 'failed' : 'completed'),
          session_id: completionSessionId,
          cwd: (message as any).cwd,
          provider,
          timestamp: (message as any).timestamp,
          debug_meta: (message as any).debug_meta,
        });

        // IMPORTANT: Set interactiveSessionId BEFORE isLoading=false
        // This ensures that when useProcessChanged fires (process still running),
        // interactiveSessionIdRef.current is already set, preventing it from
        // re-setting isLoading=true
        if (runtimeSessionId) {
          // Save the interactive session ID so we can send more messages to it
          setInteractiveSessionId(runtimeSessionId);
          // Don't clear hasActiveSessionRef - the process is still running
        } else if (!isAssistantEndTurn) {
          // Batch mode: session is complete
          hasActiveSessionRef.current = false;
          setInteractiveSessionId(null);
        }

        setIsLoading(false);

        // Process next queued prompt if any
        processNextInQueue();

        // Set workspace status to idle (AI is not actively responding)
        const currentProjectPath = projectPathRef.current;
        if (currentProjectPath) {
          setWorkspaceStatus(currentProjectPath, 'idle');
        }
      }

      addMessage(message);

      // Save session after assistant messages
      if (message.type === 'assistant' && extractedSessionInfoRef.current) {
        scheduleSessionSave(provider);
      }
    } catch (err) {
      console.error('[useSessionFrameEvents] Failed to parse message:', err);
    }
  }, [
    claudeSessionId,
    isMountedRef,
    projectPath,
    setClaudeSessionId,
    setExtractedSessionInfo,
    setIsLoading,
    projectPathRef,
    extractedSessionInfoRef,
    messagesLengthRef,
    isPendingSendRef,
    hasActiveSessionRef,
    addMessage,
    enqueueRuntimeTrackerUpdate,
    flushPendingSessionSave,
    flushRuntimeTracker,
    onComplete,
    trackToolExecution,
    trackToolFailure,
    trackFileOperation,
    trackCodeBlock,
    trackError,
    trackEvent,
    workflowTracking,
    updateWorkspaceTodos,
    scheduleSessionSave,
    // Extract provider from message to add to dependencies
    // Note: Since provider is derived from message itself, we don't need to add it to dependencies
  ]);

  /**
   * Handle completion events
   * This fires when the process actually terminates (not just a result message)
   */
  const processComplete = useCallback(async (completion: boolean | string | ClaudeCompletionPayload) => {
    flushRuntimeTracker();
    flushPendingSessionSave();
    const completePayload = coerceCompletionPayload(completion);
    if (completePayload.session_id) {
      if (completedRuntimeSessionsRef.current.has(completePayload.session_id)) {
        return;
      }
      completedRuntimeSessionsRef.current.add(completePayload.session_id);
    }
    hasActiveSessionRef.current = false;
    // Process terminated, clear interactive session (update ref immediately)
    clearInteractiveSessionIdAfterProcessExit(setInteractiveSessionId);
    setIsLoading(false);

    const terminalMessage = {
      type: 'result',
      subtype: completePayload.status,
      session_id: completePayload.session_id,
      cwd: completePayload.cwd || projectPathRef.current,
      provider: completePayload.provider || options.provider || 'claude',
      timestamp: completePayload.timestamp || new Date().toISOString(),
      debug_meta: completePayload.debug_meta || (completePayload.runtime ? { runtime_state: completePayload.runtime } : undefined),
      is_error: completePayload.status === 'failed',
    };
    applyRuntimeMessage(projectPathRef.current, terminalMessage as any);
    await onComplete?.(completePayload);

    // Process next queued prompt if any
    processNextInQueue();

    // Set workspace status to idle when session completes
    // Note: WorkspaceTodoContext will automatically convert to 'unread' if todos were completed
    const currentProjectPath = projectPathRef.current;
    if (currentProjectPath) {
      setWorkspaceStatus(currentProjectPath, 'idle');
    }
  }, [flushRuntimeTracker, flushPendingSessionSave, setIsLoading, hasActiveSessionRef, setInteractiveSessionId, onComplete, processNextInQueue, projectPathRef, setWorkspaceStatus, options.provider]);

  useProcessChanged(projectPath, (event) => {
    if (event.state !== "stopped") return;
    const provider = event.provider_id || options.provider || "claude";
    if (options.provider && provider !== options.provider) return;
    void processComplete({
      success: event.exitCode === undefined ? true : event.exitCode === 0,
      status: event.exitCode === undefined || event.exitCode === 0 ? "completed" : "failed",
      session_id: event.session_id,
      cwd: event.cwd,
      provider,
      exitCode: event.exitCode,
    });
  });

  useSessionFrameMessages(streamId, handleStreamMessage, {
    skipInitial: messagesLengthRef.current > 0 && !hasActiveSessionRef.current,
  });

  useEffect(() => {
    if (!projectPath) return;

    const handleErrorPayload = (payload: unknown) => {
      console.error('[useSessionFrameEvents] Error event:', payload);

      const errorData = parseEventObject(payload);
      if (errorData?.level && errorData.level !== 'error') {
        console.warn('[useSessionFrameEvents] Non-error provider stderr:', errorData);
        return;
      }
      if (errorData) {
        if (errorData.cwd && errorData.cwd !== projectPathRef.current) return;

        const errorMessage: ClaudeStreamMessage = {
          type: "error",
          error: errorData.error || errorData.message || 'Unknown error',
          cwd: errorData.cwd,
          provider: errorData.provider,
          timestamp: new Date().toISOString()
        } as ClaudeStreamMessage;

        addMessage(errorMessage);
        trackError();

        // Stop loading state since session failed
        setIsLoading(false);
        hasActiveSessionRef.current = false;
        clearInteractiveSessionIdAfterProcessExit(setInteractiveSessionId);
        return;
      }

      const errorMessage: ClaudeStreamMessage = {
        type: "error",
        error: String(payload),
        timestamp: new Date().toISOString()
      } as ClaudeStreamMessage;
      addMessage(errorMessage);
      trackError();
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      clearInteractiveSessionIdAfterProcessExit(setInteractiveSessionId);
    };

    const handleCompletePayload = (payload: unknown) => {
      const completePayload = parseCompletionPayload(payload);
      if (completePayload?.cwd && completePayload.cwd !== projectPathRef.current) return;
      void processComplete(completePayload ?? String(payload));
    };

    const unlistenError = EventsOn('claude-error', handleErrorPayload);
    const unlistenComplete = EventsOn('claude-complete', handleCompletePayload);

    return () => {
      unlistenError();
      unlistenComplete();
    };
  }, [projectPath, processComplete, projectPathRef]);

  return {
    handleStreamMessage,
    processComplete,
  };
}
