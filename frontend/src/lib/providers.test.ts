import test from 'node:test';
import assert from 'node:assert/strict';

test('normalizeProviderSessions turns null rpc results into an empty list', async () => {
  const { normalizeProviderSessions } = await import('./providers');
  const session = {
    id: 'one',
    project_id: 'project',
    project_path: 'E:\\repo',
    created_at: 1,
  };

  assert.deepEqual(normalizeProviderSessions(null), []);
  assert.deepEqual(normalizeProviderSessions(undefined), []);
  assert.deepEqual(normalizeProviderSessions([session]), [session]);
});
