import { useEffect } from 'react';
import { api } from '@/lib/api';
import { providers } from '@/lib/providers';
import { wsClient } from '@/lib/ws-rpc-client';
import { SessionPersistenceService } from '@/services/sessionPersistence';
import type { ClaudeStreamMessage } from '../types';
import type { UseProcessStateReturn } from './useProcessState';
import type { UseSessionMessagesReturn } from './useSessionMessages';
import type { UseSessionStateReturn } from './useSessionState';

const activeRecoveryKeys = new Set<string>();

interface UseSessionRecoveryOptions {
  defaultProvider: string;
  messagesState: UseSessionMessagesReturn;
  processState: UseProcessStateReturn;
  sessionState: UseSessionStateReturn;
  skipRecoveryUntilRef: React.MutableRefObject<number>;
  setIsRecoveringHistory: (isRecovering: boolean) => void;
  refreshSubagentTranscripts: (sessionId?: string | null, projectId?: string | null) => Promise<void>;
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
}

export function useSessionRecovery({
  defaultProvider,
  messagesState,
  processState,
  sessionState,
  skipRecoveryUntilRef,
  setIsRecoveringHistory,
  refreshSubagentTranscripts,
  scrollToBottom,
}: UseSessionRecoveryOptions): void {
  useEffect(() => {
    let recoverTimer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;
    let lastRecoveryTime = 0;
    let isRecovering = false;
    const minRecoveryInterval = 5000;

    const recoverMessages = async (trigger: string) => {
      if (!isMounted) return;

      const localCount = messagesState.messagesLengthRef.current;
      if (localCount === 0) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - no local messages yet, initial restore will handle`);
        return;
      }

      if (processState.isLoading) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - still streaming`);
        return;
      }

      if (isRecovering) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - component recovery already running`);
        return;
      }

      const now = Date.now();
      if (now - lastRecoveryTime < minRecoveryInterval) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - too soon (${Math.round((now - lastRecoveryTime) / 1000)}s since last)`);
        return;
      }

      let sessionId = sessionState.claudeSessionIdRef?.current;
      const projectPath = sessionState.projectPathRef.current;
      let projectId = sessionState.extractedSessionInfoRef.current?.projectId;

      if ((!sessionId || !projectId) && projectPath) {
        const saved = SessionPersistenceService.getSessionIndex()
          .map((sid) => SessionPersistenceService.loadSession(sid))
          .filter((session) => session && session.projectPath === projectPath && (session.provider || 'claude') === defaultProvider)
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (saved.length > 0 && saved[0]) {
          sessionId = sessionId || saved[0].sessionId;
          projectId = projectId || saved[0].projectId;
          console.log(`[AiCodeSession] Recovery (${trigger}): used localStorage fallback`);
        }
      }

      if (!sessionId || !projectPath || !projectId) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - missing identifiers`, {
          sessionId: !!sessionId,
          projectPath: !!projectPath,
          projectId: !!projectId,
        });
        return;
      }

      const recoveryKey = `${defaultProvider}::${projectPath}::${projectId}::${sessionId}`;
      if (activeRecoveryKeys.has(recoveryKey)) {
        console.log(`[AiCodeSession] Recovery (${trigger}): skipped - recovery already active for ${recoveryKey}`);
        return;
      }

      isRecovering = true;
      activeRecoveryKeys.add(recoveryKey);
      lastRecoveryTime = now;

      try {
        setIsRecoveringHistory(true);

        const running = await api.isClaudeSessionRunningForProject(projectPath, sessionId);
        if (!isMounted) return;
        if (!running) {
          processState.setIsLoading(false);
          processState.hasActiveSessionRef.current = false;
        }

        if (!running && localCount > 0) {
          return;
        }

        const history = await providers.loadHistory(sessionId, projectId, defaultProvider);
        if (!isMounted) return;

        if (!history || history.length === 0) {
          console.log(`[AiCodeSession] Recovery (${trigger}): backend returned empty history`);
          return;
        }

        const loadedMessages = history.map((entry) => normalizeHistoryMessageType(entry));

        messagesState.flushPendingMessages();
        const currentMessages = messagesState.messagesRef.current;
        const backendLastTs = loadedMessages[loadedMessages.length - 1]?.timestamp as string || '';
        const localLastTs = currentMessages[currentMessages.length - 1]?.timestamp as string || '';

        console.log(`[AiCodeSession] Recovery (${trigger}): backend last ts=${backendLastTs}, local last ts=${localLastTs}, local count=${currentMessages.length}`);

        if (backendLastTs > localLastTs) {
          console.log(`[AiCodeSession] Recovery (${trigger}): backend has newer messages, replacing local (${currentMessages.length}) with backend (${loadedMessages.length})`);
          messagesState.setMessages(loadedMessages);
          await refreshSubagentTranscripts(sessionId, projectId);
          setTimeout(() => scrollToBottom('auto'), 100);
        } else {
          await refreshSubagentTranscripts(sessionId, projectId);
          console.log(`[AiCodeSession] Recovery (${trigger}): local is up to date, skipping`);
        }
      } catch (err) {
        console.error(`[AiCodeSession] Recovery (${trigger}) failed`, {
          recoveryKey,
          sessionId,
          projectId,
          projectPath,
          provider: defaultProvider,
          error: formatRecoveryError(err),
        });
      } finally {
        activeRecoveryKeys.delete(recoveryKey);
        isRecovering = false;
        if (isMounted) {
          setIsRecoveringHistory(false);
        }
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

    const unsub = wsClient.onConnect(() => {
      console.log('[AiCodeSession] WS connected, scheduling recovery check');
      scheduleRecover('onConnect');
    });

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
}

function normalizeHistoryMessageType(entry: any): ClaudeStreamMessage {
  let messageType = entry.type;
  if (!messageType) {
    if (entry.role === 'user' || entry.message?.role === 'user' || entry.user_message) {
      messageType = 'user';
    } else if (entry.subtype === 'init' || entry.session_id) {
      messageType = 'system';
    } else {
      messageType = 'assistant';
    }
  }

  return { ...entry, type: messageType } as ClaudeStreamMessage;
}

function formatRecoveryError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  try {
    return JSON.parse(JSON.stringify(err));
  } catch {
    return String(err);
  }
}
