import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./ws-rpc-client.ts');
  } catch (error) {
    assert.fail(`ws-rpc-client module not implemented: ${error}`);
  }
}

test('uses longer timeout for interactive Claude session startup', async () => {
  const { getRpcTimeout } = await loadModule();

  assert.equal(getRpcTimeout('StartInteractiveClaudeSession') > 30_000, true);
});
