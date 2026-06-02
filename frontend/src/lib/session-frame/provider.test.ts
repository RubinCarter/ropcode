import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SESSION_PROVIDER, resolveSessionProvider } from './provider';

test('resolveSessionProvider uses the first explicit provider', () => {
  assert.equal(resolveSessionProvider(undefined, 'codex', 'claude'), 'codex');
});

test('resolveSessionProvider falls back to the default provider', () => {
  assert.equal(resolveSessionProvider(undefined, null, ''), DEFAULT_SESSION_PROVIDER);
});

