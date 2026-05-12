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
import { createInitialRuntimeTracker, reduceRuntimeTracker } from "../utils/runtimeState";

export interface UseSessionEventsOptions {
  projectPath: string;
  claudeSessionId: string | null;
  effectiveSession: Session | null;
  provider?: string;  // Provider ID (claude, codex, etc.)
  isMountedRef: React.MutableRefObject<boolean>;

  // State setters
  setClaudeSessionId: (id: string | null) => void;
  setExtractedSessionInfo: (info: SessionInfo | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsPendingSend: (pending: boolean) => void;
  setInteractiveSessionId: (id: string | null) => void;
  setRuntimeTracker: React.Dispatch<React.SetStateAction<SessionRuntimeTracker>>;

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
  timestamp?: string;
  runtime?: unknown;
  debug_meta?: {
    runtime_state?: unknown;
  };
}

export interface UseSessionEventsReturn {
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
  const content = message.message?.content;
  if (!Array.isArray(content)) return false;
  return content.every((block: any) => block?.type === 'text');
}

function coerceCompletionPayload(completion: boolean | string | ClaudeCompletionPayload): ClaudeCompletionPayload {
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

  return {
    ...completion,
    success: Boolean(completion.success),
    status: completion.status || (completion.success ? 'completed' : 'failed'),
  };
}

/**
 * Hook to manage session events
 */
export function useSessionEvents(options: UseSessionEventsOptions): UseSessionEventsReturn {
  const {
    projectPath,
    claudeSessionId,
    isMountedRef,
    setClaudeSessionId,
    setExtractedSessionInfo,
    setIsLoading,
    setInteractiveSessionId,
    setRuntimeTracker,
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
  const pendingRuntimeMessagesRef = useRef<ClaudeStreamMessage[]>([]);
  const runtimeFlushRafRef = useRef<number | null>(null);
  const pendingSessionSaveRef = useRef<{
    sessionId: string;
    projectId: string;
    projectPath: string;
    provider: string;
    messageCount: number;
  } | null>(null);
  const sessionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRuntimeTracker = useCallback(() => {
    if (runtimeFlushRafRef.current !== null) {
      cancelAnimationFrame(runtimeFlushRafRef.current);
      runtimeFlushRafRef.current = null;
    }

    const pendingMessages = pendingRuntimeMessagesRef.current;
    if (pendingMessages.length === 0) return;
    pendingRuntimeMessagesRef.current = [];
    const now = Date.now();
    setRuntimeTracker((current) => pendingMessages.reduce(
      (tracker, runtimeMessage) => reduceRuntimeTracker(tracker, runtimeMessage as any, now),
      current
    ));
  }, [setRuntimeTracker]);

  const enqueueRuntimeTrackerUpdate = useCallback((message: ClaudeStreamMessage) => {
    pendingRuntimeMessagesRef.current.push(message);
    if (runtimeFlushRafRef.current === null) {
      runtimeFlushRafRef.current = requestAnimationFrame(flushRuntimeTracker);
    }
  }, [flushRuntimeTracker]);

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
    setRuntimeTracker(createInitialRuntimeTracker());
  }, [projectPath, setRuntimeTracker]);

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
        setClaudeSessionId(message.session_id);

        // Set workspace status to 'working' when session starts
        if (projectPath) {
          setWorkspaceStatus(projectPath, 'working');
        }

        // Update session_id in ProjectList via API
        const currentProjectPath = projectPathRef.current;
        if (currentProjectPath && message.session_id) {
          api.updateProviderSession(currentProjectPath, provider, message.session_id)
            .catch((err: unknown) => {
              // Silently ignore "no rows" errors - workspace might not be in database yet
              if (!String(err).includes('no rows in result set')) {
                console.error('[useSessionEvents] Failed to update session_id in ProjectList:', err);
              }
            });
        }

        // If this is a new session, sync state immediately
        // But in interactive mode, don't override isLoading from process state
        if (!oldSessionId || message.session_id !== oldSessionId) {
          const currentProjectPath = projectPathRef.current;
          if (currentProjectPath) {
            setTimeout(() => {
              // Don't sync if we're pending a send
              if (isPendingSendRef.current) {
                return;
              }

              // Check the actual provider session state (Gemini/Codex/Claude) instead of defaulting to Claude
              api.isClaudeSessionRunningForProject(currentProjectPath, provider).then((running: boolean) => {
                hasActiveSessionRef.current = running;
                // In interactive mode, isLoading is controlled by message flow,
                // not by process running state. The process is always running.
                // Only set isLoading from process state for batch mode.
                // For init messages, isLoading should already be true (set when sending).
              }).catch((err: unknown) => {
                console.error('[useSessionEvents] Failed to sync state:', err);
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
            runtimeSessionId: message.session_id,
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
                  console.error('[useSessionEvents] Failed to parse TodoWrite:', err);
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

      // Handle result messages
      if (message.type === 'result') {
        flushRuntimeTracker();
        flushPendingSessionSave();
        console.log('[useSessionEvents] Result message received, session_id:', message.session_id);
        void onComplete?.({
          success: !(message as any).is_error,
          status: (message as any).is_error ? 'failed' : 'completed',
          session_id: message.session_id,
          cwd: (message as any).cwd,
          provider,
          timestamp: (message as any).timestamp,
          debug_meta: (message as any).debug_meta,
        });

        // IMPORTANT: Set interactiveSessionId BEFORE isLoading=false
        // This ensures that when useProcessChanged fires (process still running),
        // interactiveSessionIdRef.current is already set, preventing it from
        // re-setting isLoading=true
        if (message.session_id) {
          // Save the interactive session ID so we can send more messages to it
          setInteractiveSessionId(message.session_id);
          // Don't clear hasActiveSessionRef - the process is still running
        } else {
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
      console.error('[useSessionEvents] Failed to parse message:', err);
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
    setRuntimeTracker,
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
    hasActiveSessionRef.current = false;
    // Process terminated, clear interactive session (update ref immediately)
    setInteractiveSessionId(null);
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
    setRuntimeTracker((current) => reduceRuntimeTracker(current, terminalMessage as any, Date.now()));
    await onComplete?.(completePayload);

    // Process next queued prompt if any
    processNextInQueue();

    // Set workspace status to idle when session completes
    // Note: WorkspaceTodoContext will automatically convert to 'unread' if todos were completed
    const currentProjectPath = projectPathRef.current;
    if (currentProjectPath) {
      setWorkspaceStatus(currentProjectPath, 'idle');
    }
  }, [flushRuntimeTracker, flushPendingSessionSave, setIsLoading, hasActiveSessionRef, setInteractiveSessionId, onComplete, processNextInQueue, projectPathRef, setWorkspaceStatus, setRuntimeTracker, options.provider]);

  // Set up browser event listeners
  useEffect(() => {
    if (!projectPath) return;

    const handleOutput = (e: Event) => {
      const customEvent = e as CustomEvent;
      handleStreamMessage(customEvent.detail);
    };

    const handleError = (e: Event) => {
      const customEvent = e as CustomEvent;
      console.error('[useSessionEvents] Error event:', customEvent.detail);

      // Parse error and display to user
      try {
        const errorData = typeof customEvent.detail === 'string'
          ? JSON.parse(customEvent.detail)
          : customEvent.detail;

        // Use type: "error" to match StreamMessage rendering
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
      } catch (parseErr) {
        // If parsing fails, show raw error
        const errorMessage: ClaudeStreamMessage = {
          type: "error",
          error: String(customEvent.detail),
          timestamp: new Date().toISOString()
        } as ClaudeStreamMessage;
        addMessage(errorMessage);
        trackError();
        setIsLoading(false);
        hasActiveSessionRef.current = false;
      }
    };

    const handleComplete = (e: Event) => {
      const customEvent = e as CustomEvent;
      processComplete(customEvent.detail);
    };

    // Listen for events specific to this cwd
    window.addEventListener(`claude-output:${projectPath}`, handleOutput);
    window.addEventListener(`claude-error:${projectPath}`, handleError);
    window.addEventListener(`claude-complete:${projectPath}`, handleComplete);

    return () => {
      window.removeEventListener(`claude-output:${projectPath}`, handleOutput);
      window.removeEventListener(`claude-error:${projectPath}`, handleError);
      window.removeEventListener(`claude-complete:${projectPath}`, handleComplete);
    };
  }, [projectPath, handleStreamMessage, processComplete]);

  return {
    handleStreamMessage,
    processComplete,
  };
}
