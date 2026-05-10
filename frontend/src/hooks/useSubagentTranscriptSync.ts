import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { api } from '@/lib/api';
import type { ClaudeStreamMessageLike, SubagentProgressSummary } from '@/lib/subagentProgress';

const FINAL_REFRESH_DELAYS_MS = [750, 2000, 5000];
const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface UseSubagentTranscriptSyncOptions<TMessage extends ClaudeStreamMessageLike = ClaudeStreamMessageLike> {
  sessionId?: string | null;
  projectId?: string | null;
  enabled?: boolean;
  active?: boolean;
  subagentProgress: SubagentProgressSummary;
  setSubagentTranscripts: Dispatch<SetStateAction<Record<string, TMessage[]>>>;
  refreshKey?: string | number | null;
  pollIntervalMs?: number;
}

function serializeTranscripts(transcripts: Record<string, ClaudeStreamMessageLike[]>): string {
  return Object.keys(transcripts)
    .sort()
    .map((agentId) => {
      const transcript = transcripts[agentId] ?? [];
      const lastMessage = transcript[transcript.length - 1];
      return [
        agentId,
        transcript.length,
        lastMessage?.timestamp ?? '',
        lastMessage?.uuid ?? '',
        lastMessage?.type ?? '',
      ].join(':');
    })
    .join('|');
}

export function useSubagentTranscriptSync<TMessage extends ClaudeStreamMessageLike = ClaudeStreamMessageLike>({
  sessionId,
  projectId,
  enabled = true,
  active = false,
  subagentProgress,
  setSubagentTranscripts,
  refreshKey,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseSubagentTranscriptSyncOptions<TMessage>): void {
  const inflightKeysRef = useRef<Set<string>>(new Set());
  const latestLoadKeyRef = useRef<string>('');
  const lastLoadedKeyRef = useRef<string | null>(null);
  const lastTranscriptSigRef = useRef<string>('');
  const finalRefreshTimeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasSubagents = subagentProgress.subagents.length > 0;
  const canLoad = Boolean(enabled && sessionId && projectId && hasSubagents);
  const shouldPoll = Boolean(canLoad && active && subagentProgress.runningCount > 0);
  const loadKey = useMemo(() => {
    if (!canLoad) return '';
    return [sessionId, projectId].join('::');
  }, [canLoad, projectId, sessionId]);
  const syncKey = useMemo(() => {
    if (!canLoad) return '';
    return [loadKey, refreshKey ?? '', subagentProgress.runningCount, subagentProgress.subagents.length].join('::');
  }, [canLoad, loadKey, refreshKey, subagentProgress.runningCount, subagentProgress.subagents.length]);

  latestLoadKeyRef.current = loadKey;

  const clearFinalRefreshTimeouts = useCallback(() => {
    finalRefreshTimeoutRefs.current.forEach(clearTimeout);
    finalRefreshTimeoutRefs.current = [];
  }, []);

  const clearPollInterval = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const loadTranscripts = useCallback(async () => {
    if (!canLoad || !sessionId || !projectId || !loadKey) {
      return;
    }

    if (inflightKeysRef.current.has(loadKey)) {
      return;
    }

    inflightKeysRef.current.add(loadKey);

    try {
      const transcripts = await api.loadSubagentTranscripts(sessionId, projectId);
      if (latestLoadKeyRef.current !== loadKey) {
        return;
      }

      const nextTranscripts = (transcripts || {}) as Record<string, TMessage[]>;
      const nextSig = serializeTranscripts(nextTranscripts);
      if (lastLoadedKeyRef.current === loadKey && lastTranscriptSigRef.current === nextSig) {
        return;
      }

      lastLoadedKeyRef.current = loadKey;
      lastTranscriptSigRef.current = nextSig;
      setSubagentTranscripts(nextTranscripts);
    } catch (error) {
      console.warn('[useSubagentTranscriptSync] Failed to load subagent transcripts:', error);
    } finally {
      inflightKeysRef.current.delete(loadKey);
    }
  }, [canLoad, loadKey, projectId, sessionId, setSubagentTranscripts]);

  useEffect(() => {
    if (!canLoad) {
      clearFinalRefreshTimeouts();
      clearPollInterval();
      lastLoadedKeyRef.current = null;
      lastTranscriptSigRef.current = '';
      return;
    }

    void loadTranscripts();
    clearFinalRefreshTimeouts();
    finalRefreshTimeoutRefs.current = FINAL_REFRESH_DELAYS_MS.map((delayMs) => setTimeout(() => {
      void loadTranscripts();
    }, delayMs));

    return clearFinalRefreshTimeouts;
  }, [canLoad, clearFinalRefreshTimeouts, clearPollInterval, loadTranscripts, syncKey]);

  useEffect(() => {
    clearPollInterval();
    if (!shouldPoll) {
      return;
    }

    pollIntervalRef.current = setInterval(() => {
      void loadTranscripts();
    }, pollIntervalMs);

    return clearPollInterval;
  }, [clearPollInterval, loadTranscripts, pollIntervalMs, shouldPoll]);

  useEffect(() => {
    return () => {
      clearFinalRefreshTimeouts();
      clearPollInterval();
    };
  }, [clearFinalRefreshTimeouts, clearPollInterval]);
}
