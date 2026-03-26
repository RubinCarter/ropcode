import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./clearCommand.ts');
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

test('uses local fallback for clear handling across providers', async () => {
  const { shouldUseLocalClearFallback } = await loadModule();

  assert.equal(shouldUseLocalClearFallback('/clear', 'claude'), true);
  assert.equal(shouldUseLocalClearFallback('/clear', 'codex'), true);
  assert.equal(shouldUseLocalClearFallback('/clear', 'gemini'), true);
});

test('creates a fresh Claude session for /clear', async () => {
  const { shouldCreateFreshClaudeSession } = await loadModule();

  assert.equal(shouldCreateFreshClaudeSession('/clear', 'claude'), true);
  assert.equal(shouldCreateFreshClaudeSession('/clear', 'codex'), false);
  assert.equal(shouldCreateFreshClaudeSession('/clear now', 'claude'), false);
});

test('does not require immediately stopping the active Claude session on /clear', async () => {
  const { shouldStopClaudeSessionImmediately } = await loadModule();

  assert.equal(shouldStopClaudeSessionImmediately('/clear', 'claude'), false);
  assert.equal(shouldStopClaudeSessionImmediately('/clear', 'codex'), false);
  assert.equal(shouldStopClaudeSessionImmediately('/clear now', 'claude'), false);
});

test('describes idle Claude clear without claiming a session was stopped', async () => {
  const { getLocalClearMessage } = await loadModule();

  assert.equal(
    getLocalClearMessage({ provider: 'claude', didStopSession: false }),
    'Conversation cleared. The next message will start a fresh Claude session.'
  );

  assert.equal(
    getLocalClearMessage({ provider: 'claude', didStopSession: true }),
    'Conversation cleared. Claude session stopped; the next message will start fresh.'
  );

  assert.equal(
    getLocalClearMessage({ provider: 'codex', didStopSession: false }),
    'Local conversation view cleared. Provider session was not reset.'
  );
});
