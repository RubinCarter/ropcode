import { useCallback, useEffect, useState } from 'react';
import { api, type ProviderSessionSummary } from '@/lib/api';
import type { main } from '@/lib/rpc-client';
import { generateSessionTitleForSessionViaEvent } from '@/lib/titleGeneration';

export interface UseSpaceSessionsOptions {
  spacePath: string | null;
  activeTabUpdater?: (sessionId: string, title: string) => void;
}

export function useSpaceSessions({ spacePath, activeTabUpdater }: UseSpaceSessionsOptions) {
  const [sessions, setSessions] = useState<ProviderSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAll, setLoadedAll] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [regeneratingSessionTitles, setRegeneratingSessionTitles] = useState<Set<string>>(new Set());

  const loadSpaceSessions = useCallback(async (targetSpacePath: string, limit: number) => {
    if (!targetSpacePath) return;

    setLoading(true);
    setError(null);

    try {
      const result = limit > 0
        ? await api.listSpaceSessions(targetSpacePath, 10)
        : await api.listSpaceSessions(targetSpacePath, 0);

      setSessions(result.sessions ?? []);
      setHasMore(result.has_more ?? false);
      setLoadedAll(limit <= 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback((force = false) => {
    if (!spacePath) return;
    const limit = loadedAll ? 0 : 10;
    if (force) {
      setSessions([]);
      setLoadedAll(false);
      setHasMore(false);
    }
    loadSpaceSessions(spacePath, limit);
  }, [loadedAll, loadSpaceSessions, spacePath]);

  const loadMore = useCallback(() => {
    if (!spacePath) return;
    loadSpaceSessions(spacePath, 0);
  }, [loadSpaceSessions, spacePath]);

  const regenerateTitle = useCallback(async (session: ProviderSessionSummary) => {
    const key = `${session.provider}:${session.id}`;
    if (!spacePath || !session.provider || !session.id || !session.project_id) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'error', message: 'Session is missing identifiers; cannot regenerate title' },
      }));
      return;
    }

    setRegeneratingSessionTitles(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const title = await generateSessionTitleForSessionViaEvent(session.provider, session.id, session.project_id);
      const cleaned = title?.trim();
      if (!cleaned) {
        throw new Error('Model returned an empty title');
      }

      setSessions(prev => prev.map(item =>
        item.provider === session.provider && item.id === session.id
          ? { ...item, title: cleaned }
          : item
      ));
      activeTabUpdater?.(session.id, cleaned);

      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'success', message: `Renamed session to "${cleaned}"` },
      }));
    } catch (err) {
      console.error('[useSpaceSessions] Failed to regenerate session title:', err);
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { type: 'error', message: `Title regeneration failed: ${message}` },
      }));
    } finally {
      setRegeneratingSessionTitles(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [activeTabUpdater, spacePath]);

  useEffect(() => {
    if (!spacePath) {
      setSessions([]);
      setLoading(false);
      setError(null);
      setLoadedAll(false);
      setHasMore(false);
      return;
    }
    loadSpaceSessions(spacePath, 10);
  }, [loadSpaceSessions, spacePath]);

  useEffect(() => {
    const loadRunningProviderSessions = async () => {
      try {
        const liveSessions = await api.listRunningProviderSessions() as main.LiveProviderSession[];
        const sessionIds = new Set<string>();

        for (const session of liveSessions ?? []) {
          if (session.provider && session.session_id) {
            sessionIds.add(`${session.provider}:${session.session_id}`);
          }
        }

        setRunningSessionIds(sessionIds);
      } catch (err) {
        console.error('[useSpaceSessions] Failed to list running provider sessions:', err);
      }
    };

    loadRunningProviderSessions();
    const interval = setInterval(loadRunningProviderSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleSpaceSessionsRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ spacePath?: string; force?: boolean }>).detail;
      if (!detail?.spacePath || detail.spacePath !== spacePath) return;

      const limit = loadedAll ? 0 : 10;
      if (detail.force) {
        setSessions([]);
        setTimeout(() => loadSpaceSessions(detail.spacePath!, limit), 250);
        setTimeout(() => loadSpaceSessions(detail.spacePath!, limit), 1500);
        return;
      }
      setTimeout(() => loadSpaceSessions(detail.spacePath!, limit), 250);
    };

    window.addEventListener('ropcode-space-sessions-refresh', handleSpaceSessionsRefresh);
    return () => window.removeEventListener('ropcode-space-sessions-refresh', handleSpaceSessionsRefresh);
  }, [loadedAll, loadSpaceSessions, spacePath]);

  return {
    sessions,
    loading,
    error,
    loadedAll,
    hasMore,
    runningSessionIds,
    regeneratingSessionTitles,
    loadMore,
    refresh,
    regenerateTitle,
  };
}
