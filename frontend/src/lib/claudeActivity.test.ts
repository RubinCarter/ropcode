import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  activityBadgeCount,
  activityStatusLabel,
  findActiveClaudeSessionForProject,
} from './claudeActivity';

describe('claudeActivity helpers', () => {
  it('finds the running Claude session for the active project', () => {
    const session = findActiveClaudeSessionForProject([
      { session_id: 'old', project_path: 'E:/repo', model: '', status: 'completed', started_at: '', runtime: {} as any },
      { session_id: 'live', project_path: 'E:/repo', model: '', status: 'running', started_at: '', runtime: {} as any },
    ], 'E:/repo');

    assert.equal(session?.session_id, 'live');
  });

  it('counts task badge from active statuses', () => {
    assert.equal(activityBadgeCount({
      session_id: 's',
      project_path: 'p',
      activities: [],
      subagents: [],
      background_tasks: [],
      other: [],
      running_count: 2,
      stopping_count: 1,
      failed_count: 1,
    }), 4);
  });

  it('normalizes stop_unknown status label', () => {
    assert.equal(activityStatusLabel('stop_unknown'), 'unknown');
  });
});
