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

export function activityStatusLabel(status: main.ClaudeActivity['status']): string {
  switch (status) {
    case 'stop_unknown':
      return 'unknown';
    default:
      return status;
  }
}
