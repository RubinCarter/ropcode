import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const useSessionFrameEventsPath = path.resolve(currentDir, './useSessionFrameEvents.ts');

async function readSource() {
  return readFile(useSessionFrameEventsPath, 'utf8');
}

test('provider init messages persist provider session id but keep runtime id for live RPC', async () => {
  const source = await readSource();

  assert.match(source, /const runtimeSessionId = \(message as any\)\.runtime_session_id \|\| message\.session_id;/);
  assert.match(source, /setClaudeSessionId\(runtimeSessionId\)/);
  assert.match(source, /api\.updateProviderSession\(currentProjectPath,\s*provider,\s*runtimeSessionId\)/);
  assert.match(source, /api\.isClaudeSessionRunningForProject\(currentProjectPath,\s*runtimeSessionId\)/);
  assert.match(source, /const realClaudeSessionId = \(message as any\)\.claude_session_id \|\| \(message as any\)\.sessionId \|\| message\.session_id;/);
  assert.match(source, /SessionPersistenceService\.saveSession\(\s*persistSessionId,/);
  assert.match(source, /runtimeSessionId,\s*claudeSessionId: realClaudeSessionId/);
});

test('provider result messages keep live interactive session id from runtime_session_id', async () => {
  const source = await readSource();

  assert.match(source, /const runtimeSessionId = \(message as any\)\.runtime_session_id \|\| message\.session_id;/);
  assert.match(source, /if \(runtimeSessionId\) \{[\s\S]*setInteractiveSessionId\(runtimeSessionId\)/);
  assert.doesNotMatch(source, /if \(message\.session_id\) \{[\s\S]*setInteractiveSessionId\(message\.session_id\)/);
});

test('provider stderr warnings do not create session error messages', async () => {
  const source = await readSource();

  assert.match(source, /if \(errorData\?\.level && errorData\.level !== 'error'\) \{/);
  assert.match(source, /console\.warn\('\[useSessionFrameEvents\] Non-error provider stderr:', errorData\);/);
  assert.match(source, /return;\s*\}\s*if \(errorData\) \{/);
});
