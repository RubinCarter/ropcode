import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, CircleAlert, FileText, Loader2, Square, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { claude, main } from '@/lib/rpc-client';
import {
  activityStatusLabel,
  canLoadActivityLog,
  findActiveClaudeSessionForProject,
  normalizeClaudeActivitySnapshot,
} from '@/lib/claudeActivity';
import { emptyTranscript, parseTranscriptLines, type ParsedTranscript } from '@/lib/subagentLog';
import { usePageVisibilityPolling } from '@/hooks';
import { SubagentLogView } from './SubagentLogView';

interface ClaudeActivityPaneProps {
  workspacePath?: string;
  className?: string;
  onSnapshotChange?: (snapshot: main.ClaudeActivitySnapshot | null) => void;
}

interface ActivityListProps {
  title: string;
  icon: React.ReactNode;
  activities: main.ClaudeActivity[];
  sessionId: string;
  expandedLogs: Set<string>;
  logTails: Record<string, main.ClaudeActivityLogTail | undefined>;
  subagentLogs: Map<string, ParsedTranscript>;
  loadingLogs: Set<string>;
  stoppingIds: Set<string>;
  onToggleLog: (activity: main.ClaudeActivity) => void;
  onStop: (activity: main.ClaudeActivity) => void;
  onLoadEarlier: (activity: main.ClaudeActivity) => void;
}

function isLocalAgent(activity: main.ClaudeActivity): boolean {
  return activity.type === 'local_agent';
}

export const ClaudeActivityPane: React.FC<ClaudeActivityPaneProps> = ({
  workspacePath,
  className,
  onSnapshotChange,
}) => {
  const [activeSession, setActiveSession] = useState<claude.SessionStatus | null>(null);
  const [snapshot, setSnapshot] = useState<main.ClaudeActivitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [logTails, setLogTails] = useState<Record<string, main.ClaudeActivityLogTail | undefined>>({});
  const [subagentLogs, setSubagentLogs] = useState<Map<string, ParsedTranscript>>(new Map());
  const [loadingLogs, setLoadingLogs] = useState<Set<string>>(new Set());
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

  const subagentLogsRef = useRef(subagentLogs);
  useEffect(() => {
    subagentLogsRef.current = subagentLogs;
  }, [subagentLogs]);

  const loadingEarlierRef = useRef<Set<string>>(new Set());
  const expandedLogsRef = useRef(expandedLogs);
  useEffect(() => {
    expandedLogsRef.current = expandedLogs;
  }, [expandedLogs]);

  const previousSessionIdRef = useRef<string | null>(null);

  const applyFileMissing = useCallback((activityId: string) => {
    setSubagentLogs((prev) => {
      const existing = prev.get(activityId);
      if (existing?.fileMissing) return prev;
      const next = new Map(prev);
      next.set(activityId, { ...(existing ?? emptyTranscript()), fileMissing: true });
      return next;
    });
  }, []);

  const fetchSubagentChunk = useCallback(async (
    sessionId: string,
    activityId: string,
    since: number,
  ) => {
    const chunk = await api.ReadClaudeSubagentLog(sessionId, activityId, since);
    setSubagentLogs((prev) => {
      const existing = prev.get(activityId);
      const next = new Map(prev);
      if (chunk.file_missing) {
        next.set(activityId, { ...(existing ?? emptyTranscript()), fileMissing: true });
        return next;
      }
      const newMessages = parseTranscriptLines(chunk.lines);
      if (since === -1) {
        next.set(activityId, {
          messages: newMessages,
          lastLineIndex: chunk.next_line_index,
          truncatedBefore: chunk.truncated_before,
          fileMissing: false,
          loadingEarlier: existing?.loadingEarlier ?? false,
        });
      } else {
        const baseMessages = existing?.messages ?? [];
        next.set(activityId, {
          ...(existing ?? emptyTranscript()),
          messages: newMessages.length > 0 ? [...baseMessages, ...newMessages] : baseMessages,
          lastLineIndex: chunk.next_line_index,
          fileMissing: false,
        });
      }
      return next;
    });
  }, []);

  const loadSubagentLogInitial = useCallback(async (sessionId: string, activityId: string) => {
    setLoadingLogs((current) => new Set(current).add(activityId));
    try {
      await fetchSubagentChunk(sessionId, activityId, -1);
    } catch (err) {
      console.error('[ClaudeActivityPane] subagent log initial fetch failed', err);
    } finally {
      setLoadingLogs((current) => {
        const next = new Set(current);
        next.delete(activityId);
        return next;
      });
    }
  }, [fetchSubagentChunk]);

  const loadSubagentLogIncremental = useCallback(async (sessionId: string, activityId: string) => {
    if (loadingEarlierRef.current.has(activityId)) return;
    const existing = subagentLogsRef.current.get(activityId);
    if (!existing) return;
    if (existing.fileMissing) return;
    try {
      await fetchSubagentChunk(sessionId, activityId, existing.lastLineIndex);
    } catch (err) {
      console.error('[ClaudeActivityPane] subagent log incremental fetch failed', err);
    }
  }, [fetchSubagentChunk]);

  const loadBashLogTail = useCallback(async (
    sessionId: string,
    activityId: string,
    showSpinner: boolean,
  ) => {
    if (showSpinner) {
      setLoadingLogs((current) => new Set(current).add(activityId));
    }
    try {
      const tail = await api.GetClaudeActivityLogTail(sessionId, activityId, 80);
      setLogTails((current) => ({ ...current, [activityId]: tail }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogTails((current) => ({
        ...current,
        [activityId]: {
          session_id: sessionId,
          activity_id: activityId,
          content: '',
          line_count: 0,
          truncated_lines: 0,
          truncated_bytes: 0,
          error: message,
          path_exists: false,
          bytes_read: 0,
          requested_lines: 80,
        } as main.ClaudeActivityLogTail,
      }));
    } finally {
      if (showSpinner) {
        setLoadingLogs((current) => {
          const next = new Set(current);
          next.delete(activityId);
          return next;
        });
      }
    }
  }, []);

  const refreshExpandedLogs = useCallback(async (
    sessionId: string,
    nextSnapshot: main.ClaudeActivitySnapshot,
  ) => {
    const expanded = expandedLogsRef.current;
    if (expanded.size === 0) return;
    const activities = nextSnapshot.activities.filter(
      (a) => expanded.has(a.id) && canLoadActivityLog(a),
    );
    await Promise.all(activities.map((activity) => {
      if (isLocalAgent(activity)) {
        return loadSubagentLogIncremental(sessionId, activity.id);
      }
      return loadBashLogTail(sessionId, activity.id, false);
    }));
  }, [loadBashLogTail, loadSubagentLogIncremental]);

  const pollActivities = useCallback(async () => {
    if (!workspacePath) {
      setActiveSession(null);
      setSnapshot(null);
      onSnapshotChange?.(null);
      return;
    }

    const sessions = await api.ListRunningClaudeSessions();
    const session = findActiveClaudeSessionForProject(sessions, workspacePath);
    setActiveSession(session ?? null);
    if (!session) {
      setSnapshot(null);
      onSnapshotChange?.(null);
      setError(null);
      return;
    }

    if (previousSessionIdRef.current !== session.session_id) {
      previousSessionIdRef.current = session.session_id;
      setSubagentLogs(new Map());
      setLogTails({});
      loadingEarlierRef.current = new Set();
    }

    try {
      const next = normalizeClaudeActivitySnapshot(await api.GetClaudeSessionActivities(session.session_id));
      setSnapshot(next);
      onSnapshotChange?.(next);

      const liveIds = new Set(next.activities.map((a) => a.id));
      setSubagentLogs((prev) => {
        let changed = false;
        const map = new Map(prev);
        for (const id of map.keys()) {
          if (!liveIds.has(id)) {
            map.delete(id);
            changed = true;
          }
        }
        return changed ? map : prev;
      });

      await refreshExpandedLogs(session.session_id, next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSnapshot(null);
      onSnapshotChange?.(null);
    }
  }, [workspacePath, onSnapshotChange, refreshExpandedLogs]);

  usePageVisibilityPolling(pollActivities, {
    interval: 2500,
    enabled: true,
    immediate: true,
  });

  const handleToggleLog = useCallback((activity: main.ClaudeActivity) => {
    const willExpand = !expandedLogs.has(activity.id);

    setExpandedLogs((current) => {
      const next = new Set(current);
      if (next.has(activity.id)) {
        next.delete(activity.id);
      } else {
        next.add(activity.id);
      }
      return next;
    });

    if (!willExpand || !activeSession) return;

    if (isLocalAgent(activity)) {
      const cached = subagentLogsRef.current.get(activity.id);
      if (!cached) {
        void loadSubagentLogInitial(activeSession.session_id, activity.id);
      } else {
        void loadSubagentLogIncremental(activeSession.session_id, activity.id);
      }
    } else {
      void loadBashLogTail(activeSession.session_id, activity.id, true);
    }
  }, [
    expandedLogs,
    activeSession,
    loadSubagentLogInitial,
    loadSubagentLogIncremental,
    loadBashLogTail,
  ]);

  const handleStop = useCallback(async (activity: main.ClaudeActivity) => {
    if (!activeSession) return;
    setStoppingIds((current) => new Set(current).add(activity.id));
    try {
      await api.StopClaudeActivity(activeSession.session_id, activity.id);
      await pollActivities();
    } finally {
      setStoppingIds((current) => {
        const next = new Set(current);
        next.delete(activity.id);
        return next;
      });
    }
  }, [activeSession, pollActivities]);

  const handleLoadEarlier = useCallback(async (activity: main.ClaudeActivity) => {
    if (!activeSession) return;
    if (loadingEarlierRef.current.has(activity.id)) return;
    const existing = subagentLogsRef.current.get(activity.id);
    if (!existing || existing.truncatedBefore <= 0) return;

    loadingEarlierRef.current.add(activity.id);

    setSubagentLogs((prev) => {
      const cur = prev.get(activity.id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(activity.id, { ...cur, loadingEarlier: true });
      return next;
    });

    const targetLine = existing.truncatedBefore;
    const collected: string[] = [];

    try {
      let since = 0;
      while (since < targetLine) {
        const chunk = await api.ReadClaudeSubagentLog(
          activeSession.session_id,
          activity.id,
          since,
        );
        if (chunk.file_missing) {
          applyFileMissing(activity.id);
          return;
        }
        if (chunk.lines.length === 0) break;
        const linesToTake = Math.min(chunk.lines.length, targetLine - since);
        for (let i = 0; i < linesToTake; i++) {
          collected.push(chunk.lines[i]);
        }
        if (chunk.next_line_index <= since) break;
        since = chunk.next_line_index;
      }

      const earlierMessages = parseTranscriptLines(collected);
      setSubagentLogs((prev) => {
        const cur = prev.get(activity.id);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(activity.id, {
          ...cur,
          messages: [...earlierMessages, ...cur.messages],
          truncatedBefore: 0,
          loadingEarlier: false,
        });
        return next;
      });
    } catch (err) {
      console.error('[ClaudeActivityPane] load earlier failed', err);
    } finally {
      loadingEarlierRef.current.delete(activity.id);
      setSubagentLogs((prev) => {
        const cur = prev.get(activity.id);
        if (!cur || !cur.loadingEarlier) return prev;
        const next = new Map(prev);
        next.set(activity.id, { ...cur, loadingEarlier: false });
        return next;
      });
    }
  }, [activeSession, applyFileMissing]);

  const hasActivities = Boolean(snapshot && snapshot.activities.length > 0);
  return (
    <div className={cn('h-full flex flex-col bg-background', className)}>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Claude Tasks</div>
            <div className="text-xs text-muted-foreground truncate">
              {activeSession ? activeSession.session_id.slice(0, 8) : 'No running Claude session'}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {!activeSession && (
        <div className="flex-1 grid place-items-center px-4 text-center text-sm text-muted-foreground">
          Select a Claude chat with a running interactive session.
        </div>
      )}

      {activeSession && !hasActivities && (
        <div className="flex-1 grid place-items-center px-4 text-center text-sm text-muted-foreground">
          No background tasks for this session.
        </div>
      )}

      {activeSession && hasActivities && snapshot && (
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-3">
            <ActivityList
              title="Subagents"
              icon={<Bot className="h-3.5 w-3.5" />}
              activities={snapshot.subagents}
              sessionId={snapshot.session_id}
              expandedLogs={expandedLogs}
              logTails={logTails}
              subagentLogs={subagentLogs}
              loadingLogs={loadingLogs}
              stoppingIds={stoppingIds}
              onToggleLog={handleToggleLog}
              onStop={handleStop}
              onLoadEarlier={handleLoadEarlier}
            />
            <ActivityList
              title="Background Tasks"
              icon={<TerminalSquare className="h-3.5 w-3.5" />}
              activities={snapshot.background_tasks}
              sessionId={snapshot.session_id}
              expandedLogs={expandedLogs}
              logTails={logTails}
              subagentLogs={subagentLogs}
              loadingLogs={loadingLogs}
              stoppingIds={stoppingIds}
              onToggleLog={handleToggleLog}
              onStop={handleStop}
              onLoadEarlier={handleLoadEarlier}
            />
            {snapshot.other.length > 0 && (
              <ActivityList
                title="Other"
                icon={<FileText className="h-3.5 w-3.5" />}
                activities={snapshot.other}
                sessionId={snapshot.session_id}
                expandedLogs={expandedLogs}
                logTails={logTails}
                subagentLogs={subagentLogs}
                loadingLogs={loadingLogs}
                stoppingIds={stoppingIds}
                onToggleLog={handleToggleLog}
                onStop={handleStop}
                onLoadEarlier={handleLoadEarlier}
              />
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

const ActivityList: React.FC<ActivityListProps> = ({
  title,
  icon,
  activities,
  expandedLogs,
  logTails,
  subagentLogs,
  loadingLogs,
  stoppingIds,
  onToggleLog,
  onStop,
  onLoadEarlier,
}) => {
  const countLabel = useMemo(() => activities.length.toString(), [activities.length]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {icon}
          <span>{title}</span>
        </div>
        <span>{countLabel}</span>
      </div>

      {activities.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">None</div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => {
            const expanded = expandedLogs.has(activity.id);
            const tail = logTails[activity.id];
            const transcript = subagentLogs.get(activity.id);
            const loadingLog = loadingLogs.has(activity.id);
            const stopping = stoppingIds.has(activity.id) || activity.status === 'stopping';
            const agent = isLocalAgent(activity);

            return (
              <div key={activity.id} className="rounded-md border bg-card text-card-foreground">
                <div className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {activity.description || activity.id}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{activity.task_type || activity.type}</span>
                        <span>pid: null</span>
                        <span>{formatTime(activity.started_at)}</span>
                      </div>
                    </div>
                    <span className={cn('rounded px-1.5 py-0.5 text-[11px]', statusClass(activity.status))}>
                      {activityStatusLabel(activity.status)}
                    </span>
                  </div>

                  {(activity.summary || activity.last_activity || activity.error) && (
                    <div className="text-xs text-muted-foreground break-words">
                      {activity.error || activity.summary || activity.last_activity}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onToggleLog(activity)}
                      disabled={!canLoadActivityLog(activity)}
                    >
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Log
                    </Button>
                    {activity.can_stop && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onStop(activity)}
                        disabled={stopping}
                      >
                        {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                        Stop
                      </Button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t bg-muted/20 p-2">
                    {agent ? (
                      transcript ? (
                        <SubagentLogView
                          transcript={transcript}
                          onLoadEarlier={() => onLoadEarlier(activity)}
                        />
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading transcript
                        </div>
                      )
                    ) : loadingLog ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading log
                      </div>
                    ) : (
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-[11px] leading-5">
                        {tail?.error || tail?.content || 'No log output'}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusClass(status: main.ClaudeActivity['status']): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-300';
    case 'stopping':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'failed':
      return 'bg-destructive/10 text-destructive';
    case 'stale':
    case 'stop_unknown':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
}

export default ClaudeActivityPane;
