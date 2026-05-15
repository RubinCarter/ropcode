import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  activityBadgeCount,
  activityStatusLabel,
  findActiveClaudeSessionForProject,
  getExpandedLogActivities,
  normalizeClaudeActivitySnapshot,
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

  it('normalizes null activity arrays from older or malformed snapshots', () => {
    const snapshot = normalizeClaudeActivitySnapshot({
      session_id: 's',
      project_path: 'p',
      activities: null,
      subagents: null,
      background_tasks: null,
      other: null,
      running_count: 0,
      stopping_count: 0,
      failed_count: 0,
    } as any);

    assert.deepEqual(snapshot.activities, []);
    assert.deepEqual(snapshot.subagents, []);
    assert.deepEqual(snapshot.background_tasks, []);
    assert.deepEqual(snapshot.other, []);
  });

  it('finds expanded activities with log files for tail refresh', () => {
    const snapshot = {
      session_id: 's',
      project_path: 'p',
      activities: [
        { id: 'a', output_file: 'a.log' },
        { id: 'b', output_file: '' },
        { id: 'c', output_file: 'c.log' },
      ],
      subagents: [],
      background_tasks: [],
      other: [],
      running_count: 1,
      stopping_count: 0,
      failed_count: 0,
    } as any;

    const activities = getExpandedLogActivities(snapshot, new Set(['a', 'b', 'missing']));

    assert.deepEqual(activities.map((activity) => activity.id), ['a']);
  });
});
