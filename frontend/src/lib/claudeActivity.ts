import type { claude, main } from './rpc-client';

export function findActiveClaudeSessionForProject(
  sessions: claude.SessionStatus[],
  projectPath?: string,
): claude.SessionStatus | undefined {
  if (!projectPath) return undefined;
  return sessions.find((session) => session.project_path === projectPath && session.status === 'running');
}

export function activityBadgeCount(snapshot?: main.ClaudeActivitySnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.running_count + snapshot.stopping_count + snapshot.failed_count;
}

export function normalizeClaudeActivitySnapshot(
  snapshot: main.ClaudeActivitySnapshot,
): main.ClaudeActivitySnapshot {
  return {
    ...snapshot,
    activities: Array.isArray(snapshot.activities) ? snapshot.activities : [],
    subagents: Array.isArray(snapshot.subagents) ? snapshot.subagents : [],
    background_tasks: Array.isArray(snapshot.background_tasks) ? snapshot.background_tasks : [],
    other: Array.isArray(snapshot.other) ? snapshot.other : [],
  };
}

export function getExpandedLogActivities(
  snapshot: main.ClaudeActivitySnapshot,
  expandedLogs: Set<string>,
): main.ClaudeActivity[] {
  if (expandedLogs.size === 0) return [];
  return snapshot.activities.filter((activity) => expandedLogs.has(activity.id) && Boolean(activity.output_file));
}

export function activityStatusLabel(status: main.ClaudeActivity['status']): string {
  switch (status) {
    case 'stop_unknown':
      return 'unknown';
    default:
      return status;
  }
}
