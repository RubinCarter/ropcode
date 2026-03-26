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

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  ChevronDown,
  ChevronUp,
  X,
  Hash,
  ArrowDownToLine,
  ArrowUpFromLine
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/ws-rpc-client";
import { providers } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { StreamMessage } from "../StreamMessage";
import { FloatingPromptInput, type FloatingPromptInputRef } from "../FloatingPromptInput";
import { ErrorBoundary } from "../ErrorBoundary";
import { SlashCommandsManager } from "../SlashCommandsManager";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TooltipProvider, TooltipSimple } from "@/components/ui/tooltip-modern";
import { SplitPane } from "@/components/ui/split-pane";
import { WebviewPreview } from "../WebviewPreview";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useTrackEvent, useComponentMetrics, useWorkflowTracking } from "@/hooks";
import { SessionPersistenceService } from "@/services/sessionPersistence";
import { maybeWrapFirstMessage } from "@/lib/worktreeHelper";
import { STOP_STATUS_BUBBLE_DURATION_MS, getStopStatusBubbleState, shouldCompleteStopStatusBubble } from "./utils/stopStatusBubble";

// Import refactored hooks and types
import type { AiCodeSessionProps, ClaudeStreamMessage } from "./types";
import {
  useSessionState,
  useMessages,
  useProcessState,
  usePromptQueue,
  useSessionMetrics,
  useSessionEvents,
} from "./hooks";

/**
 * AI Code Session component for interactive AI coding sessions
 *
 * @example
 * <AiCodeSession onBack={() => setView('projects')} />
 */
export const AiCodeSession: React.FC<AiCodeSessionProps> = ({
  session,
  initialProjectPath = "",
  className,
  onStreamingChange,
  onProjectPathChange,
  defaultProvider = "claude",
  onProviderChange,
}) => {
  // ==================================================================
  // REFS (Must be declared before hooks that use them)
  // ==================================================================

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);
  const isIMEComposingRef = useRef(false);
  const loadedSessionIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const skipRecoveryUntilRef = useRef(0);
  const pendingFreshClaudeSessionRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // ==================================================================

  // Session state
  const sessionState = useSessionState({
    session,
    initialProjectPath,
  });

  // Messages state
  const messagesState = useMessages();

  // Process state
  const processState = useProcessState({
    projectPath: sessionState.projectPath,
    provider: defaultProvider,
  });

  // Session metrics
  const metricsState = useSessionMetrics({
    wasResumed: !!session,
  });

  // Analytics
  const trackEvent = useTrackEvent();
  useComponentMetrics('AiCodeSession');
  const workflowTracking = useWorkflowTracking('ai_session');

  // Prompt queue - defined before eventsState
  const queueState = usePromptQueue({
    onProcessNext: (prompt) => handleSendPrompt(prompt.prompt, prompt.model, prompt.providerApiId, prompt.thinkingMode),
  });

  // Session events - depends on all other hooks
  // Note: eventsState sets up event listeners internally, doesn't need to be used explicitly
  useSessionEvents({
    projectPath: sessionState.projectPath,
    claudeSessionId: sessionState.claudeSessionId,
    effectiveSession: sessionState.effectiveSession,
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

  // ==================================================================
  // UI STATE (not extracted to hooks - pure UI concerns)
  // ==================================================================

  const [error, setError] = useState<string | null>(null);
  const [copyPopoverOpen, setCopyPopoverOpen] = useState(false);
  const [showSlashCommandsSettings, setShowSlashCommandsSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [stopStatusTick, setStopStatusTick] = useState(0);
  const [isStopFeedbackVisible, setIsStopFeedbackVisible] = useState(false);
  const stopCompletedAtRef = useRef<number | null>(null);
  const stopStatusHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(33);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [isScrollPaused, setIsScrollPaused] = useState(false);
  const stopRequestedRef = useRef(false);

  // ==================================================================
  // VIRTUOSO for message list
  // ==================================================================

  // Track if user is at the bottom for auto-scroll behavior
  const [atBottom, setAtBottom] = useState(true);

  // ==================================================================
  // EFFECTS
  // ==================================================================

  // Call onProjectPathChange when component mounts
  useEffect(() => {
    if (onProjectPathChange && sessionState.projectPath) {
      onProjectPathChange(sessionState.projectPath);
    }
  }, []); // Only run on mount

  // Debug: Log projectPath on mount and changes
  useEffect(() => {
    console.log('[AiCodeSession] 🔑 ProjectPath initialized/changed:', {
      projectPath: sessionState.projectPath,
      initialProjectPath: initialProjectPath,
      sessionPath: session?.project_path
    });
  }, [sessionState.projectPath, initialProjectPath, session?.project_path]);

  // Report streaming state changes
  useEffect(() => {
    onStreamingChange?.(processState.isLoading, sessionState.claudeSessionId);
  }, [processState.isLoading, sessionState.claudeSessionId, onStreamingChange]);

  // Helper function to scroll to bottom (for manual scroll buttons and history loading)
  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior
    });
  }, []);

  // Track previous projectPath to detect changes
  const prevProjectPathRef = useRef(sessionState.projectPath);
  // Track if we're in the middle of a project switch (to prevent session restoration during reset)
  const isProjectSwitchingRef = useRef(false);

  // Reset session state when projectPath changes (project switch)
  useEffect(() => {
    if (prevProjectPathRef.current && prevProjectPathRef.current !== sessionState.projectPath) {
      console.log('[AiCodeSession] Project path changed, resetting session state:', {
        from: prevProjectPathRef.current,
        to: sessionState.projectPath
      });

      // Mark that we're switching projects
      isProjectSwitchingRef.current = true;

      // Reset session state for new project
      messagesState.clearMessages();
      sessionState.setClaudeSessionId(null);
      sessionState.setExtractedSessionInfo(null);
      sessionState.setIsFirstPrompt(true);
      loadedSessionIdRef.current = null;
      setError(null);

      // Allow session restoration after state is reset
      // Use microtask to ensure state updates are flushed
      queueMicrotask(() => {
        isProjectSwitchingRef.current = false;
      });
    }
    prevProjectPathRef.current = sessionState.projectPath;
  }, [sessionState.projectPath]);

  // Session restoration from localStorage - deferred to avoid blocking initial render
  useEffect(() => {
    // Skip if already loaded or if we're in the middle of a project switch
    if (loadedSessionIdRef.current) {
      console.log('[AiCodeSession] Already loaded session, skipping:', loadedSessionIdRef.current);
      return;
    }

    // Capture current projectPath for the async callback
    const currentProjectPath = sessionState.projectPath;

    if (currentProjectPath && !sessionState.extractedSessionInfo) {
      // Defer session restoration to next frame to allow initial render and state reset
      requestAnimationFrame(() => {
        // Double-check after yield - skip if project is switching or already loaded
        if (loadedSessionIdRef.current || isProjectSwitchingRef.current) {
          console.log('[AiCodeSession] Skipping session restore: switching=', isProjectSwitchingRef.current, 'loaded=', loadedSessionIdRef.current);
          return;
        }

        // Check if projectPath changed while waiting (use ref for latest value)
        if (sessionState.projectPathRef.current !== currentProjectPath) {
          console.log('[AiCodeSession] ProjectPath changed while waiting, skipping restore:', {
            captured: currentProjectPath,
            current: sessionState.projectPathRef.current
          });
          return;
        }

        console.log('[AiCodeSession] Attempting to restore session from localStorage for provider:', defaultProvider, 'projectPath:', currentProjectPath);

        const sessions = SessionPersistenceService.getSessionIndex();
        const projectSessions = sessions
          .map(sid => SessionPersistenceService.loadSession(sid))
          .filter(s => {
            if (!s || s.projectPath !== currentProjectPath) return false;
            // 兼容旧的 session（没有 provider 字段的默认为 claude）
            const sessionProvider = s.provider || 'claude';
            return sessionProvider === defaultProvider;
          })
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (projectSessions.length > 0 && projectSessions[0]) {
          const restoredSession = projectSessions[0];
          console.log('[AiCodeSession] Restoring session:', restoredSession.sessionId, 'for provider:', restoredSession.provider);

          loadedSessionIdRef.current = restoredSession.sessionId;
          sessionState.setExtractedSessionInfo({
            sessionId: restoredSession.sessionId,
            projectId: restoredSession.projectId
          });
          sessionState.setClaudeSessionId(restoredSession.sessionId);
          sessionState.setIsFirstPrompt(false);

          // Load session history in background
          loadRestoredHistory(restoredSession);
        } else {
          console.log('[AiCodeSession] No sessions found for project:', currentProjectPath, 'provider:', defaultProvider);
        }
      });
    }
  }, [sessionState.projectPath, defaultProvider]);

  // Load session history if resuming - deferred to avoid blocking initial render
  useEffect(() => {
    if (session) {
      if (loadedSessionIdRef.current) {
        console.log('[AiCodeSession] Already loaded session, skipping');
        return;
      }

      // Defer session loading to next frame to allow initial render
      requestAnimationFrame(() => {
        // Double-check after yield
        if (loadedSessionIdRef.current) return;

        loadedSessionIdRef.current = session.id;

        sessionState.setClaudeSessionId(session.id);

        // Set extractedSessionInfo so that effectiveSession works correctly
        sessionState.setExtractedSessionInfo({
          sessionId: session.id,
          projectId: session.project_id
        });

        loadSessionHistory();
      });
    }
  }, [session]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      console.log('[AiCodeSession] Unmounting, cleaning up');
      isMountedRef.current = false;

      // Track session engagement
      if (sessionState.effectiveSession) {
        trackEvent.sessionCompleted();

        const sessionDuration = metricsState.sessionStartTime.current ? Date.now() - metricsState.sessionStartTime.current : 0;
        const messageCount = messagesState.messages.filter(m => m.user_message).length;
        const toolsUsed = new Set<string>();
        messagesState.messages.forEach(msg => {
          if (msg.type === 'assistant' && msg.message?.content) {
            const tools = msg.message.content.filter((c: any) => c.type === 'tool_use');
            tools.forEach((tool: any) => toolsUsed.add(tool.name));
          }
        });

        const engagementScore = Math.min(100,
          (messageCount * 10) +
          (toolsUsed.size * 5) +
          (sessionDuration > 300000 ? 20 : sessionDuration / 15000)
        );

        trackEvent.sessionEngagement({
          session_duration_ms: sessionDuration,
          messages_sent: messageCount,
          tools_used: Array.from(toolsUsed),
          files_modified: 0,
          engagement_score: Math.round(engagementScore)
        });
      }

      // Save session - use effectiveSession.id (Claude UUID) not claudeSessionId (Go UUID in interactive mode)
      if (sessionState.effectiveSession && sessionState.projectPath) {
        SessionPersistenceService.saveSession(
          sessionState.effectiveSession.id,
          sessionState.effectiveSession.project_id,
          sessionState.projectPath,
          defaultProvider,
          messagesState.messages.length
        );
        console.log('[AiCodeSession] Saved session to localStorage on unmount');
      }
    };
  }, [sessionState.effectiveSession, sessionState.projectPath, sessionState.claudeSessionId, messagesState.messages.length]);

  // Force Virtuoso to re-measure when page becomes visible or fullscreen changes.
  // Uses Electron's push-based fullscreen event instead of resize polling.
  useEffect(() => {
    const forceVirtuosoRemeasure = () => {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollBy({ top: 0 });
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        forceVirtuosoRemeasure();
      }
    };

    let unlisten: (() => void) | undefined;
    if (window.electronAPI?.onFullscreenChanged) {
      unlisten = window.electronAPI.onFullscreenChanged(() => {
        setTimeout(forceVirtuosoRemeasure, 500);
      });
    } else {
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleResize = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(forceVirtuosoRemeasure, 300);
      };
      window.addEventListener('resize', handleResize);
      unlisten = () => {
        window.removeEventListener('resize', handleResize);
        if (resizeTimeout) clearTimeout(resizeTimeout);
      };
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unlisten?.();
    };
  }, []);

  // Recover missed messages after WebSocket reconnection or visibility restore.
  //
  // On iOS Safari, the WS dies when backgrounded.  When the user returns:
  //   1. forceReconnect() tears down old WS and creates a new connection
  //   2. But the React component may unmount/remount during this process
  //      (e.g. tab switching, layout changes), which unsubscribes the
  //      onConnect callback before the new connection fires it.
  //
  // To be robust against this, we trigger recovery from TWO sources:
  //   a) wsClient.onConnect — for when WS reconnects while component is mounted
  //   b) visibilitychange — for when component remounts AFTER WS already connected
  //
  // We skip recovery when localCount === 0 (initial mount, session restore
  // handles that) and debounce to avoid duplicate syncs.
  useEffect(() => {
    let recoverTimer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;
    let lastRecoveryTime = 0;
    const MIN_RECOVERY_INTERVAL = 5000; // 5秒最小间隔

    const recoverMessages = async (trigger: string) => {
      if (!isMounted) return;

      const localCount = messagesState.messagesLengthRef.current;
      // Skip if no messages loaded yet — initial session restore will handle it
      if (localCount === 0) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped — no local messages yet, initial restore will handle`);
        return;
      }

      // Skip if currently streaming to avoid clearing incomplete assistant messages
      if (processState.isLoading) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped — still streaming`);
        return;
      }

      // Debounce: skip if recovered recently
      const now = Date.now();
      if (now - lastRecoveryTime < MIN_RECOVERY_INTERVAL) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped — too soon (${Math.round((now - lastRecoveryTime) / 1000)}s since last)`);
        return;
      }
      lastRecoveryTime = now;

      // Gather session identifiers from refs
      let sessionId = sessionState.claudeSessionIdRef?.current;
      const projectPath = sessionState.projectPathRef.current;
      let projectId = sessionState.extractedSessionInfoRef.current?.projectId;

      // Fallback: if refs are empty, try localStorage
      if ((!sessionId || !projectId) && projectPath) {
        const sessions = SessionPersistenceService.getSessionIndex();
        const saved = sessions
          .map(sid => SessionPersistenceService.loadSession(sid))
          .filter(s => s && s.projectPath === projectPath && (s.provider || 'claude') === defaultProvider)
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
        if (saved.length > 0 && saved[0]) {
          sessionId = sessionId || saved[0].sessionId;
          projectId = projectId || saved[0].projectId;
          console.log(`[AiCodeSession] Recovery (${trigger}): used localStorage fallback`);
        }
      }

      if (!sessionId || !projectPath || !projectId) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped — missing identifiers`, {
          sessionId: !!sessionId, projectPath: !!projectPath, projectId: !!projectId
        });
        return;
      }

      try {
        console.log(`[AiCodeSession] Recovery (${trigger}): syncing, local messages:`, localCount);

        // Sync process state — check if task completed while disconnected
        const running = await api.isClaudeSessionRunningForProject(projectPath, defaultProvider);
        if (!isMounted) return;
        if (!running) {
          processState.setIsLoading(false);
          processState.hasActiveSessionRef.current = false;
        }

        // Reload full history from backend JSONL
        const history = await providers.loadHistory(sessionId, projectId, defaultProvider);
        if (!isMounted) return;

        if (!history || history.length === 0) {
          console.log(`[AiCodeSession] Recovery (${trigger}): backend returned empty history`);
          return;
        }

        // Prepare backend messages with proper types
        const loadedMessages: ClaudeStreamMessage[] = history.map(entry => {
          let messageType = entry.type;
          if (!messageType) {
            if (entry.role === "user" || entry.message?.role === "user" || entry.user_message) {
              messageType = "user";
            } else if (entry.subtype === "init" || entry.session_id) {
              messageType = "system";
            } else {
              messageType = "assistant";
            }
          }
          return { ...entry, type: messageType };
        });

        // Compare timestamps to detect missed messages.
        // All timestamps are now ISO 8601 strings (e.g. "2026-03-02T07:20:22.652Z"),
        // which are lexicographically comparable, so string comparison works correctly.
        // IMPORTANT: use messagesRef (ref) instead of messagesState.messages (stale closure)
        // because this runs inside useEffect([], []) whose closure captures initial empty [].
        const currentMessages = messagesState.messagesRef.current;
        const backendLastTs = loadedMessages[loadedMessages.length - 1]?.timestamp as string || '';
        const localLastTs = currentMessages[currentMessages.length - 1]?.timestamp as string || '';

        console.log(`[AiCodeSession] Recovery (${trigger}): backend last ts=${backendLastTs}, local last ts=${localLastTs}, local count=${currentMessages.length}`);

        if (backendLastTs > localLastTs) {
          console.log(`[AiCodeSession] Recovery (${trigger}): backend has newer messages, replacing local (${currentMessages.length}) with backend (${loadedMessages.length})`);
          messagesState.setMessages(loadedMessages);
          setTimeout(() => scrollToBottom('auto'), 100);
        } else {
          console.log(`[AiCodeSession] Recovery (${trigger}): local is up to date, skipping`);
        }
      } catch (err) {
        console.error(`[AiCodeSession] Recovery (${trigger}) failed:`, err instanceof Error ? err.message : err);
      }
    };

    const shouldSkipRecovery = () => Date.now() < skipRecoveryUntilRef.current;

    const scheduleRecover = (trigger: string) => {
      if (shouldSkipRecovery()) {
        console.log(`[AiCodeSession] Skipping recovery (${trigger}) during clear cooldown`);
        return;
      }
      if (recoverTimer) clearTimeout(recoverTimer);
      recoverTimer = setTimeout(() => {
        recoverTimer = null;
        if (shouldSkipRecovery()) {
          console.log(`[AiCodeSession] Skipping recovery (${trigger}) during clear cooldown`);
          return;
        }
        recoverMessages(trigger);
      }, 500);
    };

    // Source A: WS reconnection while component is mounted
    const unsub = wsClient.onConnect(() => {
      console.log('[AiCodeSession] WS connected, scheduling recovery check');
      scheduleRecover('onConnect');
    });

    // Source B: Page becomes visible (covers component remount after WS reconnected)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wsClient.isConnected()) {
        console.log('[AiCodeSession] Page visible + WS connected, scheduling recovery check');
        scheduleRecover('visibilitychange');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      unsub();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (recoverTimer) clearTimeout(recoverTimer);
    };
  }, []);

  // Listen for element selection from WebViewer
  useEffect(() => {
    const handleElementSelected = (event: CustomEvent) => {
      const { element, message, workspaceId } = event.detail;

      // Only insert if this is the active workspace
      if (workspaceId !== sessionState.projectPath) {
        console.log('[AiCodeSession] Ignoring element selection for different workspace');
        return;
      }

      // Format the element information as markdown
      const formattedMessage = `## 网页元素选择

**页面 URL**: ${element.url}
**元素类型**: ${element.tagName}
${element.selector ? `**CSS 选择器**: \`${element.selector}\`` : ''}

${element.innerText ? `**元素文本**:\n${element.innerText.substring(0, 300)}${element.innerText.length > 300 ? '...' : ''}\n` : ''}
**HTML 结构**:
\`\`\`html
${element.outerHTML}
\`\`\`

${message ? `**说明**:\n${message}` : ''}`;

      // Insert the formatted message and auto-submit
      // Use setText instead of insertText to replace the entire prompt
      if (floatingPromptRef.current) {
        floatingPromptRef.current.setText(formattedMessage);
        console.log('[AiCodeSession] Element selection set as prompt');

        // Get current config from FloatingPromptInput and directly call handleSendPrompt
        // This bypasses submitPrompt() and uses the current model/provider/thinking mode
        setTimeout(() => {
          if (floatingPromptRef.current) {
            const config = floatingPromptRef.current.getCurrentConfig();
            handleSendPrompt(
              formattedMessage,
              config.model,
              config.providerApiId,
              config.thinkingMode
            );
            console.log('[AiCodeSession] Auto-submitting element selection with config:', config);

            // Clear the input after sending
            floatingPromptRef.current.setText('');
          }
        }, 100);
      }
    };

    window.addEventListener('webview-element-selected', handleElementSelected as EventListener);
    return () => {
      window.removeEventListener('webview-element-selected', handleElementSelected as EventListener);
    };
  }, [sessionState.projectPath]);

  // ==================================================================
  // HANDLERS
  // ==================================================================

  const loadRestoredHistory = async (restoredSession: any) => {
    // Capture the projectPath at the start of loading
    const targetProjectPath = restoredSession.projectPath;

    try {
      processState.setIsLoading(true);
      const history = await providers.loadHistory(
        restoredSession.sessionId,
        restoredSession.projectId,
        restoredSession.provider || defaultProvider
      );

      // Check if projectPath changed during async load
      if (sessionState.projectPathRef.current !== targetProjectPath) {
        console.log('[AiCodeSession] ProjectPath changed during history load, discarding results:', {
          target: targetProjectPath,
          current: sessionState.projectPathRef.current
        });
        loadedSessionIdRef.current = null;
        return;
      }

      if (history && history.length > 0) {
        const loadedMessages: ClaudeStreamMessage[] = history.map(entry => {
          // 智能推断消息类型，避免将用户消息错误标记为 assistant
          let messageType = entry.type;
          if (!messageType) {
            // 通过多个字段判断消息类型
            if (entry.role === "user" || entry.message?.role === "user" || entry.user_message) {
              messageType = "user";
            } else if (entry.subtype === "init" || entry.session_id) {
              messageType = "system";
            } else {
              messageType = "assistant";
            }
          }

          return {
            ...entry,
            type: messageType
          };
        });
        messagesState.setMessages(loadedMessages);

        // Scroll to bottom after history loads
        setTimeout(() => {
          scrollToBottom('auto');
        }, 100);
      }
    } catch (err) {
      console.error('[AiCodeSession] Failed to load restored history:', err);
      loadedSessionIdRef.current = null;
      // Reset session state so the next message starts fresh without a stale --resume ID.
      // If the session file is missing, passing the old ID to --resume causes Claude to exit
      // immediately, which surfaces as "session exited before initialization completed".
      sessionState.setIsFirstPrompt(true);
      sessionState.setClaudeSessionId(null);
      sessionState.setExtractedSessionInfo(null);
      // Fallback: if session prop is now available, load via that path
      const fallbackSession = sessionRef.current;
      if (fallbackSession) {
        loadedSessionIdRef.current = fallbackSession.id;
        sessionState.setClaudeSessionId(fallbackSession.id);
        sessionState.setExtractedSessionInfo({
          sessionId: fallbackSession.id,
          projectId: fallbackSession.project_id,
        });
        loadSessionHistory();
      }
    } finally {
      processState.setIsLoading(false);
    }
  };

  const loadSessionHistory = async () => {
    const s = sessionRef.current;
    if (!s) return;

    try {
      processState.setIsLoading(true);
      setError(null);

      const history = await providers.loadHistory(
        s.id,
        s.project_id,
        (s as any).provider || defaultProvider
      );

      if (history && history.length > 0) {
        SessionPersistenceService.saveSession(
          s.id,
          s.project_id,
          s.project_path,
          (s as any).provider || defaultProvider,
          history.length
        );

        const loadedMessages: ClaudeStreamMessage[] = history.map(entry => {
          // 智能推断消息类型，避免将用户消息错误标记为 assistant
          let messageType = entry.type;
          if (!messageType) {
            // 通过多个字段判断消息类型
            if (entry.role === "user" || entry.message?.role === "user" || entry.user_message) {
              messageType = "user";
            } else if (entry.subtype === "init" || entry.session_id) {
              messageType = "system";
            } else {
              messageType = "assistant";
            }
          }

          return {
            ...entry,
            type: messageType
          };
        });

        messagesState.setMessages(loadedMessages);
        sessionState.setIsFirstPrompt(false);

        // Scroll to bottom after history loads
        setTimeout(() => {
          scrollToBottom('auto');
        }, 100);
      }
    } catch (err) {
      console.error("Failed to load session history:", err);
      setError("Failed to load session history");
    } finally {
      processState.setIsLoading(false);
    }
  };

  const showStopStatusBubble = useCallback(() => {
    if (stopStatusHideTimerRef.current) {
      clearTimeout(stopStatusHideTimerRef.current);
      stopStatusHideTimerRef.current = null;
    }
    stopCompletedAtRef.current = null;
    setIsStopFeedbackVisible(true);
    setStopStatusTick(Date.now());
  }, []);

  const completeStopStatusBubble = useCallback(() => {
    stopCompletedAtRef.current = Date.now();
    setIsStopFeedbackVisible(false);
    setStopStatusTick(Date.now());

    if (stopStatusHideTimerRef.current) {
      clearTimeout(stopStatusHideTimerRef.current);
    }

    stopStatusHideTimerRef.current = setTimeout(() => {
      stopStatusHideTimerRef.current = null;
      setStopStatusTick(Date.now());
    }, STOP_STATUS_BUBBLE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (stopStatusHideTimerRef.current) {
        clearTimeout(stopStatusHideTimerRef.current);
      }
    };
  }, []);

  const stopStatusBubble = getStopStatusBubbleState({
    isStopping: isStopFeedbackVisible,
    lastCompletedAt: stopCompletedAtRef.current,
    now: stopStatusTick || Date.now(),
  });

  useEffect(() => {
    if (!shouldCompleteStopStatusBubble({
      stopRequested: stopRequestedRef.current,
      isLoading: processState.isLoading,
      interactiveSessionId: processState.interactiveSessionId,
    })) {
      return;
    }

    stopRequestedRef.current = false;
    completeStopStatusBubble();
  }, [processState.isLoading, processState.interactiveSessionId, completeStopStatusBubble]);

  const handleSendPrompt = async (
    prompt: string,
    model: string,
    providerApiId?: string | null,
    thinkingMode?: string,
    options?: { forceFreshClaudeSession?: boolean }
  ) => {
    console.log('[AiCodeSession] Sending prompt with thinkingMode:', thinkingMode);

    if (!sessionState.projectPath) {
      setError("Please select a project directory first");
      return;
    }

    // In interactive mode, send directly (Claude CLI handles concurrent messages)
    // In batch mode, queue if already loading
    if (processState.isLoading && !processState.interactiveSessionIdRef.current) {
      console.log('[AiCodeSession] Session busy (batch mode), queueing prompt');
      queueState.addToQueue(prompt, model, providerApiId, thinkingMode);
      return;
    }

    try {
      processState.setIsLoading(true);
      processState.setIsPendingSend(true);
      setError(null);
      processState.hasActiveSessionRef.current = true;

      const forceFreshClaudeSession =
        options?.forceFreshClaudeSession === true ||
        (defaultProvider === 'claude' && pendingFreshClaudeSessionRef.current);
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

      const shouldWrapPrompt = !(defaultProvider === 'claude' && prompt.trim() === '/clear');
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

      if (currentInteractiveSessionId) {
        // Interactive session is alive (real-time state), send message directly
        console.log('[AiCodeSession] Sending to active interactive session:', currentInteractiveSessionId);
        trackEvent.sessionResumed(currentInteractiveSessionId);
        trackEvent.modelSelected(model);

        if (defaultProvider === 'claude') {
          await api.SendClaudeMessage(sessionState.projectPath, currentInteractiveSessionId, wrappedPrompt);
        } else {
          await api.resumeProviderSession(defaultProvider, sessionState.projectPath, wrappedPrompt, model, currentInteractiveSessionId, providerApiId || undefined);
        }
      } else if (currentEffectiveSession && !sessionState.isFirstPrompt && defaultProvider !== 'claude') {
        // For non-Claude providers (batch mode), can safely resume from effectiveSession
        console.log('[AiCodeSession] Resuming batch mode session');
        trackEvent.sessionResumed(currentEffectiveSession.id);
        trackEvent.modelSelected(model);

        await api.resumeProviderSession(defaultProvider, sessionState.projectPath, wrappedPrompt, model, currentEffectiveSession.id, providerApiId || undefined);
      } else {
        // Start new session:
        // - For Claude: always start new if no interactiveSessionId
        // - For others: start new if no effectiveSession or isFirstPrompt
        console.log('[AiCodeSession] Starting new session');
        sessionState.setIsFirstPrompt(false);
        trackEvent.sessionCreated(model, 'prompt_input');
        trackEvent.modelSelected(model);

        if (defaultProvider === 'claude') {
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
          await api.startProviderSession(defaultProvider, sessionState.projectPath, wrappedPrompt, model, providerApiId);
        }
      }

      // Clear pending flag after init message arrives
      setTimeout(() => {
        processState.setIsPendingSend(false);
        console.log('[AiCodeSession] isPendingSend cleared');
      }, 500);
    } catch (err) {
      console.error('[AiCodeSession] Failed to send prompt:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to send prompt: ${errorMessage}`);
      processState.setIsLoading(false);
      processState.setIsPendingSend(false);
      processState.hasActiveSessionRef.current = false;
    }
  };

  const handleLocalClearFallback = async () => {
    console.log('[AiCodeSession] Clearing local conversation fallback');

    stopRequestedRef.current = true;
    showStopStatusBubble();
    skipRecoveryUntilRef.current = Date.now() + 5000;
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
        content: [{ type: "text", text: defaultProvider === 'claude' ? "Conversation cleared. Claude session stopped; the next message will start fresh." : "Local conversation view cleared. Provider session was not reset." }]
      }
    };
    messagesState.addMessage(clearMessage);
  };

  const handleCancelExecution = async () => {
    stopRequestedRef.current = true;
    showStopStatusBubble();
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
      stopRequestedRef.current = false;
      completeStopStatusBubble();
    }
  };

  const handleCopyAsJsonl = async () => {
    const jsonl = messagesState.messages.map(m => JSON.stringify(m)).join('\n');
    await navigator.clipboard.writeText(jsonl);
    setCopyPopoverOpen(false);
  };

  const handleCopyAsMarkdown = async () => {
    let markdown = `# AI Code Session\n\n`;
    markdown += `**Project:** ${sessionState.projectPath}\n`;
    markdown += `**Date:** ${new Date().toISOString()}\n\n`;
    markdown += `---\n\n`;

    for (const msg of messagesState.messages) {
      if (msg.type === "system" && msg.subtype === "init") {
        markdown += `## System Initialization\n\n`;
        markdown += `- Session ID: \`${msg.session_id || 'N/A'}\`\n`;
        markdown += `- Model: \`${msg.model || 'default'}\`\n`;
        if (msg.cwd) markdown += `- Working Directory: \`${msg.cwd}\`\n`;
        if (msg.tools?.length) markdown += `- Tools: ${msg.tools.join(', ')}\n`;
        markdown += `\n`;
      } else if (msg.type === "assistant" && msg.message) {
        markdown += `## Assistant\n\n`;
        for (const content of msg.message.content || []) {
          if (content.type === "text") {
            const textContent = typeof content.text === 'string'
              ? content.text
              : (content.text?.text || JSON.stringify(content.text || content));
            markdown += `${textContent}\n\n`;
          } else if (content.type === "tool_use") {
            markdown += `### Tool: ${content.name}\n\n`;
            markdown += `\`\`\`json\n${JSON.stringify(content.input, null, 2)}\n\`\`\`\n\n`;
          }
        }
        if (msg.message.usage) {
          markdown += `*Tokens: ${msg.message.usage.input_tokens} in, ${msg.message.usage.output_tokens} out*\n\n`;
        }
      } else if (msg.type === "user" && msg.message) {
        markdown += `## User\n\n`;
        for (const content of msg.message.content || []) {
          if (content.type === "text") {
            const textContent = typeof content.text === 'string'
              ? content.text
              : (content.text?.text || JSON.stringify(content.text));
            markdown += `${textContent}\n\n`;
          } else if (content.type === "tool_result") {
            markdown += `### Tool Result\n\n`;
            let contentText = '';
            if (typeof content.content === 'string') {
              contentText = content.content;
            } else if (content.content && typeof content.content === 'object') {
              if (content.content.text) {
                contentText = content.content.text;
              } else if (Array.isArray(content.content)) {
                contentText = content.content
                  .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
                  .join('\n');
              } else {
                contentText = JSON.stringify(content.content, null, 2);
              }
            }
            markdown += `\`\`\`\n${contentText}\n\`\`\`\n\n`;
          }
        }
      } else if (msg.type === "result") {
        markdown += `## Execution Result\n\n`;
        if (msg.result) {
          markdown += `${msg.result}\n\n`;
        }
        if (msg.error) {
          markdown += `**Error:** ${msg.error}\n\n`;
        }
      }
    }

    await navigator.clipboard.writeText(markdown);
    setCopyPopoverOpen(false);
  };

  const handleLinkDetected = (url: string) => {
    if (!showPreview && !showPreviewPrompt) {
      setPreviewUrl(url);
      setShowPreviewPrompt(true);
    }
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setIsPreviewMaximized(false);
  };

  const handlePreviewUrlChange = (url: string) => {
    console.log('[AiCodeSession] Preview URL changed to:', url);
    setPreviewUrl(url);
  };

  const handleTogglePreviewMaximize = () => {
    setIsPreviewMaximized(!isPreviewMaximized);
    if (isPreviewMaximized) {
      setSplitPosition(50);
    }
  };

  // ==================================================================
  // RENDER - Message List
  // ==================================================================

  const messagesList = (
    <div className="relative flex-1">
      <Virtuoso
        ref={virtuosoRef}
        data={messagesState.displayableMessages}
        className="h-full"

        // followOutput handles auto-scrolling during streaming
        // Returns false to disable, 'auto' for instant scroll, 'smooth' for animated
        followOutput={(isAtBottom) => {
          // User manually paused scrolling
          if (isScrollPaused) return false;
          // User scrolled away from bottom - don't auto-scroll
          if (!isAtBottom) return false;
          // During streaming: use 'auto' to avoid animation lag
          // Otherwise: use 'smooth' for better UX
          return processState.isLoading ? 'auto' : 'smooth';
        }}

        // Track when user scrolls away from bottom
        atBottomStateChange={setAtBottom}
        atBottomThreshold={100}

        // Start at the bottom (most recent messages)
        initialTopMostItemIndex={messagesState.displayableMessages.length > 0
          ? messagesState.displayableMessages.length - 1
          : 0}

        // Stable keys prevent unnecessary re-renders
        computeItemKey={(index, message) => message.uuid || `msg-${index}`}

        // Render each message
        itemContent={(index, message) => (
          <div className="w-full max-w-6xl mx-auto px-4 pb-4 pt-2">
            <StreamMessage
              message={message}
              streamMessages={messagesState.messages}
              onLinkDetected={handleLinkDetected}
              agentOutputMap={messagesState.agentOutputMap}
            />
          </div>
        )}

        // Custom components for loading/error states
        components={{
          Header: () => <div className="pt-6" />,
          Footer: () => (
            <>
              {/* Loading indicator */}
              {processState.isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center justify-center py-4"
                >
                  <div className="rotating-symbol text-primary" />
                </motion.div>
              )}

              {/* Error indicator */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mx-4 max-w-6xl"
                >
                  {error}
                </motion.div>
              )}

              {/* Bottom spacer for floating input (needs extra space for queued prompts and image previews) */}
              <div className="h-60" />
            </>
          ),
        }}
      />

      {/* Scroll buttons */}
      {messagesState.displayableMessages.length > 5 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ delay: 0.5 }}
          className="pointer-events-none absolute bottom-32 left-0 right-0 z-30 flex justify-end px-4"
        >
          <div className="max-w-6xl w-full flex justify-end">
          <div className="flex items-center bg-background/95 backdrop-blur-md border rounded-full shadow-lg overflow-hidden pointer-events-auto">
            <TooltipSimple content={isScrollPaused ? "Resume auto-scroll" : "Lock scroll position"} side="top">
              <motion.div
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsScrollPaused(!isScrollPaused)}
                  className="px-3 py-2 hover:bg-accent rounded-none"
                >
                  {isScrollPaused ? (
                    <ArrowUpFromLine className="h-4 w-4" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4" />
                  )}
                </Button>
              </motion.div>
            </TooltipSimple>
            <div className="w-px h-6 bg-border" />
            <TooltipSimple content="Scroll to top" side="top">
              <motion.div
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    virtuosoRef.current?.scrollToIndex({
                      index: 0,
                      align: 'start',
                      behavior: 'smooth'
                    });
                  }}
                  className="px-3 py-2 hover:bg-accent rounded-none"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipSimple>
            <div className="w-px h-6 bg-border" />
            <TooltipSimple content="Scroll to bottom" side="top">
              <motion.div
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => scrollToBottom('smooth')}
                  className="px-3 py-2 hover:bg-accent rounded-none"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipSimple>
          </div>
          </div>
        </motion.div>
      )}
    </div>
  );

  // ==================================================================
  // RENDER - Main Layout
  // ==================================================================

  // If preview is maximized, render only the WebviewPreview in full screen
  if (showPreview && isPreviewMaximized) {
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
            initialUrl={previewUrl}
            onClose={handleClosePreview}
            isMaximized={isPreviewMaximized}
            onToggleMaximize={handleTogglePreviewMaximize}
            onUrlChange={handlePreviewUrlChange}
            className="h-full"
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("relative flex flex-col h-full bg-background", className)}>
        <div className="w-full h-full flex flex-col">

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden transition-all duration-300">
          {showPreview ? (
            // Split pane layout when preview is active
            <SplitPane
              left={
                <div className="h-full flex flex-col">
                  {messagesList}
                </div>
              }
              right={
                <WebviewPreview
                  initialUrl={previewUrl}
                  onClose={handleClosePreview}
                  isMaximized={isPreviewMaximized}
                  onToggleMaximize={handleTogglePreviewMaximize}
                  onUrlChange={handlePreviewUrlChange}
                />
              }
              initialSplit={splitPosition}
              onSplitChange={setSplitPosition}
              minLeftWidth={400}
              minRightWidth={400}
              className="h-full"
            />
          ) : (
            // Original layout when no preview
            <div className="h-full flex flex-col w-full">
              {messagesList}

              {processState.isLoading && messagesState.messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-3">
                    <div className="rotating-symbol text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {session ? "Loading session history..." : "Initializing AI Code..."}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Floating Prompt Input */}
        <ErrorBoundary>
          {/* Queued Prompts Display */}
          <AnimatePresence>
            {queueState.queuedPrompts.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-24 left-0 right-0 z-30 px-4"
              >
                <div className="max-w-6xl mx-auto bg-background/95 backdrop-blur-md border rounded-lg shadow-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Queued Prompts ({queueState.queuedPrompts.length})
                    </div>
                    <TooltipSimple content={queueState.queuedPromptsCollapsed ? "Expand queue" : "Collapse queue"} side="top">
                      <motion.div
                        whileTap={{ scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                      >
                        <Button variant="ghost" size="icon" onClick={() => queueState.setQueuedPromptsCollapsed(!queueState.queuedPromptsCollapsed)}>
                          {queueState.queuedPromptsCollapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      </motion.div>
                    </TooltipSimple>
                  </div>
                  {!queueState.queuedPromptsCollapsed && queueState.queuedPrompts.map((queuedPrompt, index) => (
                    <motion.div
                      key={queuedPrompt.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="flex items-start gap-2 bg-muted/50 rounded-md p-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                            {queuedPrompt.model === "opus" ? "Opus" : "Sonnet"}
                          </span>
                        </div>
                        <p className="text-sm line-clamp-2 break-words">{queuedPrompt.prompt}</p>
                      </div>
                      <motion.div
                        whileTap={{ scale: 0.97 }}
                        transition={{ duration: 0.15 }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => queueState.removeFromQueue(queuedPrompt.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </motion.div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30">
            <FloatingPromptInput
              ref={floatingPromptRef}
              onSend={handleSendPrompt}
              onClear={handleLocalClearFallback}
              onCancel={handleCancelExecution}
              stopStatusLabel={stopStatusBubble.label}
              isLoading={processState.isLoading}
              interactiveSessionId={processState.interactiveSessionId}
              disabled={!sessionState.projectPath}
              projectPath={sessionState.projectPath}
              defaultProvider={defaultProvider}
              onProviderChange={onProviderChange}
              extraMenuItems={
                messagesState.messages.length > 0 ? (
                  <Popover
                    trigger={
                      <TooltipSimple content="Copy conversation" side="top">
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </motion.div>
                      </TooltipSimple>
                    }
                    content={
                      <div className="w-44 p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyAsMarkdown}
                          className="w-full justify-start text-xs"
                        >
                          Copy as Markdown
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopyAsJsonl}
                          className="w-full justify-start text-xs"
                        >
                          Copy as JSONL
                        </Button>
                      </div>
                    }
                    open={copyPopoverOpen}
                    onOpenChange={setCopyPopoverOpen}
                    side="top"
                    align="end"
                  />
                ) : undefined
              }
            />
          </div>

          {/* Token Counter – positioned above the input bar, non-interactive */}
          <AnimatePresence>
          {messagesState.totalTokens > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 0.7, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-16 right-6 z-20 pointer-events-none"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <Hash className="h-2.5 w-2.5" />
                <span className="font-mono">{messagesState.totalTokens.toLocaleString()}</span>
                <span>tokens</span>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </ErrorBoundary>

      </div>

      {/* Slash Commands Settings Dialog */}
      {showSlashCommandsSettings && (
        <Dialog open={showSlashCommandsSettings} onOpenChange={setShowSlashCommandsSettings}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Slash Commands</DialogTitle>
              <DialogDescription>
                Manage project-specific slash commands for {sessionState.projectPath}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              <SlashCommandsManager projectPath={sessionState.projectPath} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      </div>
    </TooltipProvider>
  );
};
