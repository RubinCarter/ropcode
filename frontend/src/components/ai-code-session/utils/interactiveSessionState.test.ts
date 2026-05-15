import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./interactiveSessionState');
  } catch (error) {
    assert.fail(`interactiveSessionState module not implemented: ${error}`);
  }
}

test('clears runtime interactive session id after process exit', async () => {
  const { clearInteractiveSessionIdAfterProcessExit } = await loadModule();
  let nextId: string | null | undefined = 'stale-runtime-id';

  clearInteractiveSessionIdAfterProcessExit((id: string | null) => {
    nextId = id;
  });

  assert.equal(nextId, null);
});
