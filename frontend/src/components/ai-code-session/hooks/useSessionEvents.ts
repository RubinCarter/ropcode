/**
 * Session event handling hook
 *
 * Manages browser event listeners and stream message processing
 * This is the most complex part - handle with care!
 */

import { useEffect, useCallback } from "react";
import type { ClaudeStreamMessage, Session, SessionInfo } from "../types";
import { api } from "@/lib/api";
import { SessionPersistenceService } from "@/services/sessionPersistence";
import { useWorkspaceTodo, type TodoItem } from "@/contexts/WorkspaceTodoContext";

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

  // Refs for stable access
  projectPathRef: React.MutableRefObject<string>;
  extractedSessionInfoRef: React.MutableRefObject<SessionInfo | null>;
  messagesLengthRef: React.MutableRefObject<number>;
  isPendingSendRef: React.MutableRefObject<boolean>;
  hasActiveSessionRef: React.MutableRefObject<boolean>;

  // Callbacks
  addMessage: (message: ClaudeStreamMessage) => void;
  syncProcessState: () => Promise<void>;

  // Metrics tracking
  trackToolExecution: (toolName: string) => void;
  trackToolFailure: () => void;
  trackFileOperation: (operation: 'create' | 'modify' | 'delete') => void;
  trackCodeBlock: () => void;
  trackError: () => void;

  // Other dependencies
  totalTokens: number;
  queuedPromptsLength: number;

  // Analytics
  trackEvent: any;
  workflowTracking: any;
}

export interface UseSessionEventsReturn {
  handleStreamMessage: (payload: string) => void;
  processComplete: (success: boolean) => Promise<void>;
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
    projectPathRef,
    extractedSessionInfoRef,
    messagesLengthRef,
    isPendingSendRef,
    hasActiveSessionRef,
    addMessage,
    syncProcessState,
    trackToolExecution,
    trackToolFailure,
    trackFileOperation,
    trackCodeBlock,
    trackError,
    trackEvent,
    workflowTracking,
  } = options;

  const { updateWorkspaceTodos, setWorkspaceStatus } = useWorkspaceTodo();

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
            .catch((err) => {
              // Silently ignore "no rows" errors - workspace might not be in database yet
              if (!err.toString().includes('no rows in result set')) {
                console.error('[useSessionEvents] Failed to update session_id in ProjectList:', err);
              }
            });
        }

        // If this is a new session, sync state immediately
        if (!oldSessionId || message.session_id !== oldSessionId) {
          const currentProjectPath = projectPathRef.current;
          if (currentProjectPath) {
            setTimeout(() => {
              // Don't sync if we're pending a send
              if (isPendingSendRef.current) {
                return;
              }

              // Check the actual provider session state (Gemini/Codex/Claude) instead of defaulting to Claude
              api.isClaudeSessionRunningForProject(currentProjectPath, provider).then(running => {
                setIsLoading(running);
                hasActiveSessionRef.current = running;
              }).catch(err => {
                console.error('[useSessionEvents] Failed to sync state:', err);
              });
            }, 50);
          }
        }

        // Update extractedSessionInfo
        const projectId = projectPathRef.current.replace(/[^a-zA-Z0-9]/g, '-');
        if (!extractedSessionInfoRef.current || extractedSessionInfoRef.current.sessionId !== message.session_id) {
          setExtractedSessionInfo({ sessionId: message.session_id, projectId });
          SessionPersistenceService.saveSession(
            message.session_id,
            projectId,
            projectPathRef.current,
            provider,
            messagesLengthRef.current
          );
        }
      }

      // Track tool execution
      if (message.type === 'assistant' && message.message?.content) {
        const toolUses = message.message.content.filter((c: any) => c.type === 'tool_use');
        toolUses.forEach((toolUse: any) => {
          trackToolExecution(toolUse.name);

          // Track file operations
          const toolName = toolUse.name?.toLowerCase() || '';
          if (toolName.includes('create') || toolName.includes('write')) {
            trackFileOperation('create');
          } else if (toolName.includes('edit') || toolName.includes('multiedit') || toolName.includes('search_replace')) {
            trackFileOperation('modify');
          } else if (toolName.includes('delete')) {
            trackFileOperation('delete');
          }

          // Track workflow step
          workflowTracking.trackStep(toolUse.name);

          // TodoWrite detection and update
          if (toolUse.name === 'TodoWrite' && toolUse.input?.todos) {
            try {
              const todos = toolUse.input.todos as TodoItem[];
              if (projectPath) {
                updateWorkspaceTodos(projectPath, projectPath, todos);
              }
            } catch (err) {
              console.error('[useSessionEvents] Failed to parse TodoWrite:', err);
            }
          }
        });
      }

      // Track tool results
      if (message.type === 'user' && message.message?.content) {
        const toolResults = message.message.content.filter((c: any) => c.type === 'tool_result');
        toolResults.forEach((result: any) => {
          if (result.is_error) {
            trackToolFailure();
            trackEvent.enhancedError({
              error_type: 'tool_execution',
              error_code: 'tool_failed',
              error_message: result.content,
              context: 'Tool execution failed',
              user_action_before_error: 'executing_tool',
              recovery_attempted: false,
              recovery_successful: false,
              error_frequency: 1,
              stack_trace_hash: undefined
            });
          }
        });
      }

      // Track code blocks
      if (message.type === 'assistant' && message.message?.content) {
        const codeBlocks = message.message.content.filter((c: any) =>
          c.type === 'text' && c.text?.includes('```')
        );
        if (codeBlocks.length > 0) {
          codeBlocks.forEach((block: any) => {
            const matches = (block.text.match(/```/g) || []).length;
            const blockCount = Math.floor(matches / 2);
            for (let i = 0; i < blockCount; i++) {
              trackCodeBlock();
            }
          });
        }
      }

      // Track errors in system messages
      if (message.type === 'system' && (message.subtype === 'error' || message.error)) {
        trackError();
      }

      addMessage(message);

      // Save session after assistant messages
      if (message.type === 'assistant' && extractedSessionInfoRef.current) {
        SessionPersistenceService.saveSession(
          extractedSessionInfoRef.current.sessionId,
          extractedSessionInfoRef.current.projectId,
          projectPathRef.current,
          provider,
          messagesLengthRef.current + 1
        );
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
    trackToolExecution,
    trackToolFailure,
    trackFileOperation,
    trackCodeBlock,
    trackError,
    trackEvent,
    workflowTracking,
    updateWorkspaceTodos,
    // Extract provider from message to add to dependencies
    // Note: Since provider is derived from message itself, we don't need to add it to dependencies
  ]);

  /**
   * Handle completion events
   */
  const processComplete = useCallback(async (_success: boolean) => {
    setIsLoading(false);
    hasActiveSessionRef.current = false;

    // Sync process state after completion
    await syncProcessState();

    // Set workspace status to idle when session completes
    // Note: WorkspaceTodoContext will automatically convert to 'unread' if todos were completed
    const currentProjectPath = projectPathRef.current;
    if (currentProjectPath) {
      setWorkspaceStatus(currentProjectPath, 'idle');
    }
  }, [setIsLoading, hasActiveSessionRef, syncProcessState, projectPathRef, setWorkspaceStatus]);

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
