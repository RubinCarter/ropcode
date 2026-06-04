import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./clearCommand');
  } catch (error) {
    assert.fail(`clearCommand module not implemented: ${error}`);
  }
}

test('matches exact /clear command only', async () => {
  const { isExactClearCommand } = await loadModule();

  assert.equal(isExactClearCommand('/clear'), true);
  assert.equal(isExactClearCommand(' /clear  '), true);
  assert.equal(isExactClearCommand('/clear now'), false);
  assert.equal(isExactClearCommand('/compact'), false);
});

test('does not forward /clear to Claude provider as plain prompt', async () => {
  const { shouldForwardClearToProvider } = await loadModule();

  assert.equal(shouldForwardClearToProvider('/clear', 'claude'), false);
  assert.equal(shouldForwardClearToProvider('/clear', 'codex'), false);
  assert.equal(shouldForwardClearToProvider('/clear', 'gemini'), false);
});

test('creates a fresh provider session for /clear', async () => {
  const { shouldCreateFreshProviderSession } = await loadModule();

  assert.equal(shouldCreateFreshProviderSession('/clear', 'claude'), true);
  assert.equal(shouldCreateFreshProviderSession('/clear', 'codex'), true);
  assert.equal(shouldCreateFreshProviderSession('/clear now', 'claude'), false);
});

test('does not require immediately stopping the active provider session on /clear', async () => {
  const { shouldStopProviderSessionImmediately } = await loadModule();

  assert.equal(shouldStopProviderSessionImmediately('/clear', 'claude'), false);
  assert.equal(shouldStopProviderSessionImmediately('/clear', 'codex'), false);
  assert.equal(shouldStopProviderSessionImmediately('/clear now', 'claude'), false);
});
