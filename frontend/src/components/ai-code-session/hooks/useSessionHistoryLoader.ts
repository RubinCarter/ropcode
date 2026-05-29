import { useCallback } from 'react';
import { providers } from '@/lib/providers';
import { SessionPersistenceService } from '@/services/sessionPersistence';
import { replaceSessionFrames } from '@/stores/sessionFrameStore';
import type { ClaudeStreamMessage, Session } from '../types';
import type { UseProcessStateReturn } from './useProcessState';
import type { UseSessionMessagesReturn } from './useSessionMessages';
import type { UseSessionStateReturn } from './useSessionState';

interface RestoredSession {
  sessionId: string;
  projectId: string;
  projectPath: string;
  provider?: string;
}

interface UseSessionHistoryLoaderOptions {
  defaultProvider: string;
  loadedSessionIdRef: React.MutableRefObject<string | null>;
  messagesState: UseSessionMessagesReturn;
  processState: UseProcessStateReturn;
  sessionRef: React.MutableRefObject<Session | undefined>;
  sessionState: UseSessionStateReturn;
  setError: (error: string | null) => void;
  refreshSubagentTranscripts: (sessionId?: string | null, projectId?: string | null) => Promise<void>;
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
}

export interface UseSessionHistoryLoaderReturn {
  loadRestoredHistory: (restoredSession: RestoredSession) => Promise<void>;
  loadSessionHistory: () => Promise<void>;
}

export function useSessionHistoryLoader({
  defaultProvider,
  loadedSessionIdRef,
  messagesState,
  processState,
  sessionRef,
  sessionState,
  setError,
  refreshSubagentTranscripts,
  scrollToBottom,
}: UseSessionHistoryLoaderOptions): UseSessionHistoryLoaderReturn {
  const loadSessionHistory = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    try {
      processState.setIsLoading(true);
      setError(null);

      const provider = (session as any).provider || defaultProvider;
      const history = await providers.loadHistory(session.id, session.project_id, provider);
      const historyFrames = await loadHistoryFrames(session.id, session.project_id, provider, 'session');

      if (history && history.length > 0) {
        replaceHistoryFrames(historyFrames);
        SessionPersistenceService.saveSession(
          session.id,
          session.project_id,
          session.project_path,
          provider,
          history.length,
        );

        messagesState.setMessages(history.map((entry) => normalizeHistoryMessageType(entry)));
        await refreshSubagentTranscripts(session.id, session.project_id);
        sessionState.setIsFirstPrompt(false);
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    } catch (err) {
      console.error('Failed to load session history:', err);
      setError('Failed to load session history');
    } finally {
      processState.setIsLoading(false);
    }
  }, [
    defaultProvider,
    messagesState,
    processState,
    refreshSubagentTranscripts,
    scrollToBottom,
    sessionRef,
    sessionState,
    setError,
  ]);

  const loadRestoredHistory = useCallback(async (restoredSession: RestoredSession) => {
    const targetProjectPath = restoredSession.projectPath;

    try {
      processState.setIsLoading(true);
      const provider = restoredSession.provider || defaultProvider;
      const history = await providers.loadHistory(restoredSession.sessionId, restoredSession.projectId, provider);
      const historyFrames = await loadHistoryFrames(restoredSession.sessionId, restoredSession.projectId, provider, 'restored');

      if (sessionState.projectPathRef.current !== targetProjectPath) {
        loadedSessionIdRef.current = null;
        return;
      }

      if (history && history.length > 0) {
        replaceHistoryFrames(historyFrames);
        messagesState.setMessages(history.map((entry) => normalizeHistoryMessageType(entry)));
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    } catch (err) {
      console.error('[AiCodeSession] Failed to load restored history:', err);
      loadedSessionIdRef.current = null;
      sessionState.setIsFirstPrompt(true);
      sessionState.setClaudeSessionId(null);
      sessionState.setExtractedSessionInfo(null);

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
  }, [
    defaultProvider,
    loadSessionHistory,
    loadedSessionIdRef,
    messagesState,
    processState,
    scrollToBottom,
    sessionRef,
    sessionState,
  ]);

  return {
    loadRestoredHistory,
    loadSessionHistory,
  };
}

async function loadHistoryFrames(
  sessionId: string,
  projectId: string,
  provider: string,
  source: 'restored' | 'session',
) {
  return providers.loadHistoryFrames(sessionId, projectId, provider).catch((err) => {
    console.warn(`[AiCodeSession] Failed to load ${source} history frames:`, err);
    return [];
  });
}

function replaceHistoryFrames(historyFrames: Array<{ streamId: string }>): void {
  if (historyFrames.length > 0) {
    replaceSessionFrames(historyFrames[0].streamId, historyFrames as any);
  }
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

  return {
    ...entry,
    type: messageType,
  } as ClaudeStreamMessage;
}
