import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { SessionPersistenceService } from "@/services/sessionPersistence";
import type { ClaudeStreamMessage } from "../types";

interface UseSessionControllerLifecycleOptions {
  defaultProvider: string;
  initialProjectPath: string;
  session: any;
  skipSessionRestore: boolean;
  loadedSessionIdRef: React.MutableRefObject<string | null>;
  isMountedRef: React.MutableRefObject<boolean>;
  messagesState: any;
  metricsState: any;
  processState: any;
  sessionState: any;
  historyLoader: any;
  trackEvent: any;
  setError: (error: string | null) => void;
  onProjectPathChange?: (projectPath: string) => void;
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
  onProcessAliveChange?: (isAlive: boolean) => void;
}

export function useSessionControllerLifecycle({
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
}: UseSessionControllerLifecycleOptions): void {
  const prevProjectPathRef = useRef(sessionState.projectPath);
  const isProjectSwitchingRef = useRef(false);
  const unmountSnapshotRef = useRef({
    defaultProvider,
    effectiveSession: sessionState.effectiveSession,
    projectPath: sessionState.projectPath,
    messages: messagesState.messages,
    metricsState,
    trackEvent,
  });

  unmountSnapshotRef.current = {
    defaultProvider,
    effectiveSession: sessionState.effectiveSession,
    projectPath: sessionState.projectPath,
    messages: messagesState.messages,
    metricsState,
    trackEvent,
  };

  useEffect(() => {
    if (onProjectPathChange && sessionState.projectPath) {
      onProjectPathChange(sessionState.projectPath);
    }
  }, []);

  useEffect(() => {
    console.log('[AiCodeSession] 🔑 ProjectPath initialized/changed:', {
      projectPath: sessionState.projectPath,
      initialProjectPath,
      sessionPath: session?.project_path
    });
  }, [sessionState.projectPath, initialProjectPath, session?.project_path]);

  useEffect(() => {
    onStreamingChange?.(processState.isLoading, sessionState.claudeSessionId);
  }, [processState.isLoading, sessionState.claudeSessionId, onStreamingChange]);

  useEffect(() => {
    onProcessAliveChange?.(processState.hasActiveSessionRef.current);
  }, [processState.isLoading, processState.interactiveSessionId, onProcessAliveChange]);

  useEffect(() => {
    if (prevProjectPathRef.current && prevProjectPathRef.current !== sessionState.projectPath) {
      console.log('[AiCodeSession] Project path changed, resetting session state:', {
        from: prevProjectPathRef.current,
        to: sessionState.projectPath
      });

      isProjectSwitchingRef.current = true;
      messagesState.clearMessages();
      sessionState.setClaudeSessionId(null);
      sessionState.setExtractedSessionInfo(null);
      sessionState.setIsFirstPrompt(true);
      loadedSessionIdRef.current = null;
      setError(null);

      queueMicrotask(() => {
        isProjectSwitchingRef.current = false;
      });
    }
    prevProjectPathRef.current = sessionState.projectPath;
  }, [sessionState.projectPath]);

  useEffect(() => {
    if (skipSessionRestore) {
      console.log('[AiCodeSession] Skipping session restore for explicit new session');
      return;
    }

    if (session) {
      console.log('[AiCodeSession] Skipping session restore for explicit historical session');
      return;
    }

    if (loadedSessionIdRef.current) {
      console.log('[AiCodeSession] Already loaded session, skipping:', loadedSessionIdRef.current);
      return;
    }

    const currentProjectPath = sessionState.projectPath;

    if (currentProjectPath && !sessionState.extractedSessionInfo) {
      requestAnimationFrame(() => {
        if (loadedSessionIdRef.current || isProjectSwitchingRef.current) {
          console.log('[AiCodeSession] Skipping session restore: switching=', isProjectSwitchingRef.current, 'loaded=', loadedSessionIdRef.current);
          return;
        }

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
          historyLoader.loadRestoredHistory(restoredSession);
        } else {
          console.log('[AiCodeSession] No sessions found for project:', currentProjectPath, 'provider:', defaultProvider);
        }
      });
    }
  }, [sessionState.projectPath, defaultProvider, skipSessionRestore]);

  useEffect(() => {
    if (session) {
      if (loadedSessionIdRef.current) {
        console.log('[AiCodeSession] Already loaded session, skipping');
        return;
      }

      requestAnimationFrame(() => {
        if (loadedSessionIdRef.current) return;

        loadedSessionIdRef.current = session.id;
        sessionState.setClaudeSessionId(session.id);
        sessionState.setExtractedSessionInfo({
          sessionId: session.id,
          projectId: session.project_id
        });

        historyLoader.loadSessionHistory();
      });
    }
  }, [session]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      const snapshot = unmountSnapshotRef.current;
      console.log('[AiCodeSession] Unmounting, cleaning up');
      isMountedRef.current = false;

      if (snapshot.effectiveSession) {
        snapshot.trackEvent.sessionCompleted();
        trackSessionEngagement(snapshot.messages, snapshot.metricsState, snapshot.trackEvent);
      }

      if (snapshot.effectiveSession && snapshot.projectPath) {
        SessionPersistenceService.saveSession(
          snapshot.effectiveSession.id,
          snapshot.effectiveSession.project_id,
          snapshot.projectPath,
          snapshot.defaultProvider,
          snapshot.messages.length
        );
        console.log('[AiCodeSession] Saved session to localStorage on unmount');
      }
    };
  }, []);
}

export function useGeneratedSessionTitlePersistence(options: {
  defaultProvider: string;
  generatedSessionTitle: string | null;
  sessionState: any;
}): void {
  useEffect(() => {
    const title = options.generatedSessionTitle?.trim();
    const sessionId = options.sessionState.extractedSessionInfo?.sessionId || options.sessionState.effectiveSession?.id;
    if (!title || !sessionId || !options.sessionState.projectPath) return;

    void api.SaveGeneratedSessionTitle(options.defaultProvider, sessionId, title)
      .then(() => {
        window.dispatchEvent(new CustomEvent('ropcode-space-sessions-refresh', {
          detail: { spacePath: options.sessionState.projectPath },
        }));
      })
      .catch((err: unknown) => {
        console.warn('[AiCodeSession] Failed to save generated session title:', err);
      });
  }, [
    options.defaultProvider,
    options.generatedSessionTitle,
    options.sessionState.extractedSessionInfo?.sessionId,
    options.sessionState.effectiveSession?.id,
    options.sessionState.claudeSessionId,
    options.sessionState.projectPath,
  ]);
}

function trackSessionEngagement(messages: ClaudeStreamMessage[], metricsState: any, trackEvent: any): void {
  const sessionDuration = metricsState.sessionStartTime.current ? Date.now() - metricsState.sessionStartTime.current : 0;
  const messageCount = messages.filter(m => m.user_message).length;
  const toolsUsed = new Set<string>();
  messages.forEach(msg => {
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
