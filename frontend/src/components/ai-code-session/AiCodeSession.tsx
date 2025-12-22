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

import React, { useState, useEffect, useRef } from "react";
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTrackEvent, useComponentMetrics, useWorkflowTracking } from "@/hooks";
import { SessionPersistenceService } from "@/services/sessionPersistence";
import { maybeWrapFirstMessage } from "@/lib/worktreeHelper";

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

  const parentRef = useRef<HTMLDivElement>(null);
  const floatingPromptRef = useRef<FloatingPromptInputRef>(null);
  const isIMEComposingRef = useRef(false);
  const loadedSessionIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // ==================================================================
  // HOOKS - State management extracted to separate hooks
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
    isLoading: processState.isLoading,
    isPendingSend: processState.isPendingSend,
    projectPath: sessionState.projectPath,
    onProcessNext: (prompt) => handleSendPrompt(prompt.prompt, prompt.model),
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
    projectPathRef: sessionState.projectPathRef,
    extractedSessionInfoRef: sessionState.extractedSessionInfoRef,
    messagesLengthRef: messagesState.messagesLengthRef,
    isPendingSendRef: processState.isPendingSendRef,
    hasActiveSessionRef: processState.hasActiveSessionRef,
    addMessage: messagesState.addMessage,
    syncProcessState: processState.syncProcessState,
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
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(33);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [isScrollPaused, setIsScrollPaused] = useState(false);

  // ==================================================================
  // VIRTUALIZER for message list
  // ==================================================================

  const rowVirtualizer = useVirtualizer({
    count: messagesState.displayableMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    // Only auto-scroll if not paused
    if (messagesState.displayableMessages.length > 0 && !isScrollPaused) {
      setTimeout(() => {
        const scrollElement = parentRef.current;
        if (scrollElement) {
          rowVirtualizer.scrollToIndex(messagesState.displayableMessages.length - 1, {
            align: 'end',
            behavior: 'auto'
          });
          requestAnimationFrame(() => {
            scrollElement.scrollTo({
              top: scrollElement.scrollHeight,
              behavior: 'smooth'
            });
          });
        }
      }, 50);
    }
  }, [messagesState.displayableMessages.length, rowVirtualizer, isScrollPaused]);

  // Session restoration from localStorage
  useEffect(() => {
    if (loadedSessionIdRef.current) {
      console.log('[AiCodeSession] Already loaded session, skipping:', loadedSessionIdRef.current);
      return;
    }

    if (sessionState.projectPath && !sessionState.extractedSessionInfo) {
      console.log('[AiCodeSession] Attempting to restore session from localStorage for provider:', defaultProvider);

      const sessions = SessionPersistenceService.getSessionIndex();
      const projectSessions = sessions
        .map(sid => SessionPersistenceService.loadSession(sid))
        .filter(s => {
          if (!s || s.projectPath !== sessionState.projectPath) return false;
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

        // Load session history
        loadRestoredHistory(restoredSession);
      }
    }
  }, [sessionState.projectPath, defaultProvider]);

  // Load session history if resuming
  useEffect(() => {
    if (session) {
      if (loadedSessionIdRef.current) {
        console.log('[AiCodeSession] Already loaded session, skipping');
        return;
      }

      loadedSessionIdRef.current = session.id;

      sessionState.setClaudeSessionId(session.id);

      // Set extractedSessionInfo so that effectiveSession works correctly
      sessionState.setExtractedSessionInfo({
        sessionId: session.id,
        projectId: session.project_id
      });

      loadSessionHistory();
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

      // Save session
      if (sessionState.effectiveSession && sessionState.claudeSessionId && sessionState.projectPath) {
        SessionPersistenceService.saveSession(
          sessionState.claudeSessionId,
          sessionState.effectiveSession.project_id,
          sessionState.projectPath,
          defaultProvider,
          messagesState.messages.length
        );
        console.log('[AiCodeSession] Saved session to localStorage on unmount');
      }
    };
  }, [sessionState.effectiveSession, sessionState.projectPath, sessionState.claudeSessionId, messagesState.messages.length]);

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
    try {
      processState.setIsLoading(true);
      const history = await providers.loadHistory(
        restoredSession.sessionId,
        restoredSession.projectId,
        restoredSession.provider || defaultProvider
      );

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

        // Scroll to bottom
        setTimeout(() => {
          if (loadedMessages.length > 0) {
            const scrollElement = parentRef.current;
            if (scrollElement) {
              rowVirtualizer.scrollToIndex(loadedMessages.length - 1, { align: 'end', behavior: 'auto' });
              requestAnimationFrame(() => {
                scrollElement.scrollTo({
                  top: scrollElement.scrollHeight,
                  behavior: 'auto'
                });
              });
            }
          }
        }, 100);
      }
    } catch (err) {
      console.error('[AiCodeSession] Failed to load restored history:', err);
      loadedSessionIdRef.current = null;
    } finally {
      processState.setIsLoading(false);
    }
  };

  const loadSessionHistory = async () => {
    if (!session) return;

    try {
      processState.setIsLoading(true);
      setError(null);

      const history = await providers.loadHistory(
        session.id,
        session.project_id,
        (session as any).provider || defaultProvider
      );

      if (history && history.length > 0) {
        SessionPersistenceService.saveSession(
          session.id,
          session.project_id,
          session.project_path,
          (session as any).provider || defaultProvider,
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

        // Scroll to bottom
        setTimeout(() => {
          if (loadedMessages.length > 0) {
            const scrollElement = parentRef.current;
            if (scrollElement) {
              rowVirtualizer.scrollToIndex(loadedMessages.length - 1, { align: 'end', behavior: 'auto' });
              requestAnimationFrame(() => {
                scrollElement.scrollTo({
                  top: scrollElement.scrollHeight,
                  behavior: 'auto'
                });
              });
            }
          }
        }, 100);
      }
    } catch (err) {
      console.error("Failed to load session history:", err);
      setError("Failed to load session history");
    } finally {
      processState.setIsLoading(false);
    }
  };

  const handleSendPrompt = async (prompt: string, model: string, providerApiId?: string | null, thinkingMode?: string) => {
    console.log('[AiCodeSession] Sending prompt with thinkingMode:', thinkingMode);

    if (!sessionState.projectPath) {
      setError("Please select a project directory first");
      return;
    }

    // Queue if already loading
    if (processState.isLoading) {
      console.log('[AiCodeSession] Session busy, queueing prompt');
      queueState.addToQueue(prompt, model);
      return;
    }

    try {
      processState.setIsLoading(true);
      processState.setIsPendingSend(true);
      setError(null);
      processState.hasActiveSessionRef.current = true;

      // Ensure session ID
      if (sessionState.effectiveSession && !sessionState.claudeSessionId) {
        sessionState.setClaudeSessionId(sessionState.effectiveSession.id);
      }

      // Wrap message if needed
      const wrappedPrompt = await maybeWrapFirstMessage(
        sessionState.projectPath,
        prompt,
        sessionState.isFirstPrompt
      );

      // Add user message to UI
      const userMessage: ClaudeStreamMessage = {
        type: "user",
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
      const currentEffectiveSession = sessionState.effectiveSession;
      if (currentEffectiveSession && !sessionState.isFirstPrompt) {
        console.log('[AiCodeSession] Resuming existing session');
        trackEvent.sessionResumed(currentEffectiveSession.id);
        trackEvent.modelSelected(model);

        if (defaultProvider === 'claude') {
          await api.resumeClaudeCode(sessionState.projectPath, currentEffectiveSession.id, wrappedPrompt, model, undefined, providerApiId);
        } else {
          // For all other providers (codex, etc.), resumeProviderSession now takes prompt and model
          await api.resumeProviderSession(defaultProvider, sessionState.projectPath, wrappedPrompt, model, currentEffectiveSession.id);
        }
      } else {
        console.log('[AiCodeSession] Starting new session');
        sessionState.setIsFirstPrompt(false);
        trackEvent.sessionCreated(model, 'prompt_input');
        trackEvent.modelSelected(model);

        if (defaultProvider === 'claude') {
          await api.executeClaudeCode(sessionState.projectPath, wrappedPrompt, model, undefined, providerApiId);
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
      setError("Failed to send prompt");
      processState.setIsLoading(false);
      processState.setIsPendingSend(false);
      processState.hasActiveSessionRef.current = false;
    }
  };

  const handleClearConversation = () => {
    console.log('[AiCodeSession] Clearing conversation');

    messagesState.clearMessages();
    sessionState.setClaudeSessionId(null);
    sessionState.setExtractedSessionInfo(null);
    sessionState.setIsFirstPrompt(true);
    metricsState.resetMetrics();
    setError(null);

    const clearMessage: ClaudeStreamMessage = {
      type: "system",
      subtype: "info",
      message: {
        content: [{ type: "text", text: "Conversation cleared. Starting fresh! 🎉" }]
      }
    };
    messagesState.addMessage(clearMessage);
  };

  const handleCancelExecution = async () => {
    if (!sessionState.projectPath || !processState.isLoading) return;

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
      });

      processState.setIsLoading(false);
      processState.hasActiveSessionRef.current = false;
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
      setError(null);
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
      <div
        ref={parentRef}
        className="h-full overflow-y-auto pb-32"
        style={{
          contain: 'strict',
        }}
      >
        <div
          className="relative w-full px-4 pt-8 pb-4"
          style={{
            height: `${Math.max(rowVirtualizer.getTotalSize(), 100)}px`,
            minHeight: '100px',
          }}
        >
          <AnimatePresence>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const message = messagesState.displayableMessages[virtualItem.index];
              return (
                <motion.div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={(el) => el && rowVirtualizer.measureElement(el)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-x-4 pb-4"
                  style={{
                    top: virtualItem.start,
                  }}
                >
                  <StreamMessage
                    message={message}
                    streamMessages={messagesState.messages}
                    onLinkDetected={handleLinkDetected}
                    agentOutputMap={messagesState.agentOutputMap}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Loading indicator */}
        {processState.isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-center py-4 mb-20"
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
            className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mb-20 mx-4"
          >
            {error}
          </motion.div>
        )}
      </div>

      {/* Scroll buttons */}
      {messagesState.displayableMessages.length > 5 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ delay: 0.5 }}
          className="pointer-events-none absolute bottom-32 right-6 z-50"
        >
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
                    if (messagesState.displayableMessages.length > 0) {
                      parentRef.current?.scrollTo({
                        top: 0,
                        behavior: 'smooth'
                      });
                      setTimeout(() => {
                        if (parentRef.current) {
                          parentRef.current.scrollTop = 1;
                          requestAnimationFrame(() => {
                            if (parentRef.current) {
                              parentRef.current.scrollTop = 0;
                            }
                          });
                        }
                      }, 500);
                    }
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
                  onClick={() => {
                    if (messagesState.displayableMessages.length > 0) {
                      parentRef.current?.scrollTo({
                        top: parentRef.current.scrollHeight,
                        behavior: 'smooth'
                      });
                      setTimeout(() => {
                        rowVirtualizer.scrollToIndex(messagesState.displayableMessages.length - 1, {
                          align: 'end',
                          behavior: 'smooth'
                        });
                      }, 100);
                    }
                  }}
                  className="px-3 py-2 hover:bg-accent rounded-none"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </motion.div>
            </TooltipSimple>
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
                className="absolute bottom-24 left-4 right-4 z-30"
              >
                <div className="bg-background/95 backdrop-blur-md border rounded-lg shadow-lg p-3 space-y-2">
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

          <div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-50">
            <FloatingPromptInput
              ref={floatingPromptRef}
              onSend={handleSendPrompt}
              onClear={handleClearConversation}
              onCancel={handleCancelExecution}
              isLoading={processState.isLoading}
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

          {/* Token Counter */}
          {messagesState.totalTokens > 0 && (
            <div className="absolute bottom-0 right-0 left-0 z-30 pointer-events-none">
              <div className="max-w-6xl mx-auto">
                <div className="flex justify-end px-4 pb-2">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="bg-background/95 backdrop-blur-md border rounded-full px-3 py-1 shadow-lg pointer-events-auto"
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <Hash className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono">{messagesState.totalTokens.toLocaleString()}</span>
                      <span className="text-muted-foreground">tokens</span>
                    </div>
                  </motion.div>
                </div>
              </div>
            </div>
          )}
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
