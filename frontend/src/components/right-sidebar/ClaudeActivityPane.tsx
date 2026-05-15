import React, { useCallback, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, CircleAlert, FileText, Loader2, Square, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { claude, main } from '@/lib/rpc-client';
import { activityStatusLabel, findActiveClaudeSessionForProject } from '@/lib/claudeActivity';
import { usePageVisibilityPolling } from '@/hooks';

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
  loadingLogs: Set<string>;
  stoppingIds: Set<string>;
  onToggleLog: (activity: main.ClaudeActivity) => void;
  onStop: (activity: main.ClaudeActivity) => void;
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
  const [loadingLogs, setLoadingLogs] = useState<Set<string>>(new Set());
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());

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

    try {
      const next = await api.GetClaudeSessionActivities(session.session_id);
      setSnapshot(next);
      onSnapshotChange?.(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSnapshot(null);
      onSnapshotChange?.(null);
    }
  }, [workspacePath, onSnapshotChange]);

  usePageVisibilityPolling(pollActivities, {
    interval: 2500,
    enabled: true,
    immediate: true,
  });

  const loadLogTail = useCallback(async (activity: main.ClaudeActivity) => {
    if (!activeSession) return;

    setLoadingLogs((current) => new Set(current).add(activity.id));
    try {
      const tail = await api.GetClaudeActivityLogTail(activeSession.session_id, activity.id, 80);
      setLogTails((current) => ({ ...current, [activity.id]: tail }));
    } finally {
      setLoadingLogs((current) => {
        const next = new Set(current);
        next.delete(activity.id);
        return next;
      });
    }
  }, [activeSession]);

  const handleToggleLog = useCallback((activity: main.ClaudeActivity) => {
    setExpandedLogs((current) => {
      const next = new Set(current);
      if (next.has(activity.id)) {
        next.delete(activity.id);
        return next;
      }
      next.add(activity.id);
      return next;
    });

    if (!expandedLogs.has(activity.id)) {
      void loadLogTail(activity);
    }
  }, [expandedLogs, loadLogTail]);

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
              loadingLogs={loadingLogs}
              stoppingIds={stoppingIds}
              onToggleLog={handleToggleLog}
              onStop={handleStop}
            />
            <ActivityList
              title="Background Tasks"
              icon={<TerminalSquare className="h-3.5 w-3.5" />}
              activities={snapshot.background_tasks}
              sessionId={snapshot.session_id}
              expandedLogs={expandedLogs}
              logTails={logTails}
              loadingLogs={loadingLogs}
              stoppingIds={stoppingIds}
              onToggleLog={handleToggleLog}
              onStop={handleStop}
            />
            {snapshot.other.length > 0 && (
              <ActivityList
                title="Other"
                icon={<FileText className="h-3.5 w-3.5" />}
                activities={snapshot.other}
                sessionId={snapshot.session_id}
                expandedLogs={expandedLogs}
                logTails={logTails}
                loadingLogs={loadingLogs}
                stoppingIds={stoppingIds}
                onToggleLog={handleToggleLog}
                onStop={handleStop}
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
  loadingLogs,
  stoppingIds,
  onToggleLog,
  onStop,
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
            const loadingLog = loadingLogs.has(activity.id);
            const stopping = stoppingIds.has(activity.id) || activity.status === 'stopping';

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
                      disabled={!activity.output_file}
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
                    {loadingLog ? (
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
