import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('useSpaceSessions owns selected-space session loading and refresh events', async () => {
  const source = await readFile(path.join(currentDir, 'useSpaceSessions.ts'), 'utf8');

  assert.match(source, /export function useSpaceSessions/);
  assert.match(source, /api\.listSpaceSessions\(targetSpacePath,\s*10\)/);
  assert.match(source, /api\.listSpaceSessions\(targetSpacePath,\s*0\)/);
  assert.match(source, /api\.listRunningProviderSessions/);
  assert.match(source, /window\.addEventListener\('ropcode-space-sessions-refresh'/);
  assert.match(source, /generateSessionTitleForSessionViaEvent/);
  assert.match(source, /activeTabUpdater\?/);
});

test('SessionPanel preserves open, new session, and title-regeneration semantics', async () => {
  const source = await readFile(path.join(currentDir, 'SessionPanel.tsx'), 'utf8');

  assert.match(source, /useSpaceSessions/);
  assert.match(source, /__ROPCODE_PENDING_PROVIDER_SESSION__/);
  assert.match(source, /new CustomEvent\('open-provider-session'/);
  assert.match(source, /__ROPCODE_PENDING_NEW_SESSION__/);
  assert.match(source, /new CustomEvent\('open-new-session'/);
  assert.match(source, /regenerateTitle\(session\)/);
  assert.match(source, /onSwitchToWorkspace\(selectedSpacePath\)/);
});

test('SessionPanel only loads sessions for the active selected space', async () => {
  const source = await readFile(path.join(currentDir, 'SessionPanel.tsx'), 'utf8');

  assert.match(source, /selectedSpacePath/);
  assert.match(source, /spacePath:\s*selectedSpacePath/);
  assert.doesNotMatch(source, /projects\.map/);
  assert.doesNotMatch(source, /workspaces\.map/);
});
