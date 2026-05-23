import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSyncEvent, clearSyncEvents, getSyncEvents, subscribeSyncEvents } from './syncStore';

test('syncStore stores events and notifies subscribers', () => {
  clearSyncEvents();

  let notifications = 0;
  const unsubscribe = subscribeSyncEvents(() => {
    notifications++;
  });

  appendSyncEvent({ type: 'project:changed', projectId: 'project-1' });
  unsubscribe();

  assert.deepEqual(getSyncEvents(), [{ type: 'project:changed', projectId: 'project-1' }]);
  assert.equal(notifications, 1);
});
