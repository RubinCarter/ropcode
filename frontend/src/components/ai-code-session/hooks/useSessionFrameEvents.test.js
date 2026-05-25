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

test('provider complete events infer success from exit code', async () => {
  const { coerceCompletionPayload } = await import('./useSessionFrameEvents.ts');

  assert.deepEqual(coerceCompletionPayload({
    session_id: 'runtime-1',
    provider: 'deepseek',
    exit_code: 0,
  }), {
    session_id: 'runtime-1',
    provider: 'deepseek',
    exit_code: 0,
    success: true,
    status: 'completed',
  });

  assert.equal(coerceCompletionPayload({
    session_id: 'runtime-2',
    provider: 'deepseek',
    exit_code: 1,
  }).status, 'failed');
});

test('provider process stopped events complete matching batch runtime sessions', async () => {
  const source = await readSource();

  assert.match(source, /useProcessChanged\(projectPath,\s*\(event\) => \{/);
  assert.match(source, /if \(event\.state !== "stopped"\) return;/);
  assert.match(source, /const provider = event\.provider_id \|\| options\.provider \|\| "claude";/);
  assert.match(source, /if \(options\.provider && provider !== options\.provider\) return;/);
  assert.match(source, /session_id: event\.session_id,/);
  assert.match(source, /provider,/);
  assert.match(source, /exitCode: event\.exitCode,/);
});

test('provider completion is deduped by runtime session id', async () => {
  const source = await readSource();

  assert.match(source, /const completedRuntimeSessionsRef = useRef<Set<string>>\(new Set\(\)\);/);
  assert.match(source, /completedRuntimeSessionsRef\.current\.has\(completePayload\.session_id\)/);
  assert.match(source, /completedRuntimeSessionsRef\.current\.add\(completePayload\.session_id\)/);
});

test('Claude assistant end_turn completes the current interactive turn', async () => {
  const source = await readSource();

  assert.match(source, /const isAssistantEndTurn = message\.type === 'assistant'[\s\S]*stop_reason[\s\S]*=== 'end_turn'/);
  assert.match(source, /if \(message\.type === 'result' \|\| isAssistantEndTurn\) \{/);
  assert.match(source, /status: isAssistantEndTurn \? 'completed' :/);
});

test('Claude assistant end_turn is never treated as a text delta early return', async () => {
  const source = await readSource();

  assert.match(source, /function isTextDeltaMessage[\s\S]*stop_reason[\s\S]*return false/);
});

test('provider stderr warnings do not create session error messages', async () => {
  const source = await readSource();

  assert.match(source, /if \(errorData\?\.level && errorData\.level !== 'error'\) \{/);
  assert.match(source, /console\.warn\('\[useSessionFrameEvents\] Non-error provider stderr:', errorData\);/);
  assert.match(source, /return;\s*\}\s*if \(errorData\) \{/);
});
