import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionFrame } from './normalize';
import type { SessionFrame } from './types';

test('normalizeSessionFrame preserves stable camelCase protocol fields', () => {
  const frame = normalizeSessionFrame({
    streamId: 'stream-1',
    frameId: 'frame-1',
    messageId: 'message-1',
    operation: 'upsert',
    provider: 'claude',
    runtimeSessionId: 'runtime-1',
    providerSessionId: 'provider-1',
    cwd: 'E:/repo',
    projectPath: 'E:/repo',
    seq: 3,
    timestamp: '2026-05-23T08:00:00Z',
    kind: 'message',
    role: 'assistant',
    subtype: 'text',
    content: [
      { type: 'text', text: 'hello' },
      { type: 'thinking', text: 'plan' },
      { type: 'tool_use', toolUseId: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } },
      { type: 'tool_result', toolUseId: 'toolu_1', text: 'done', isError: false },
    ],
    parentToolUseId: 'toolu_parent',
    taskId: 'task-1',
    toolUseId: 'toolu_1',
    agentId: 'agent-1',
    sidechain: true,
    success: true,
    durationMs: 1200,
    result: 'ok',
    usage: { inputTokens: 11, outputTokens: 13, totalTokens: 24, toolUseCount: 1 },
    runtime: {
      phase: 'tool_running',
      activeTool: 'Read',
      progressText: 'Reading README.md',
      retry: { attempt: 2, maxAttempts: 5, nextRetryMs: 8000 },
    },
    meta: { raw: { provider_field: 'kept' } },
  });

  assert.equal(frame.streamId, 'stream-1');
  assert.equal(frame.messageId, 'message-1');
  assert.equal(frame.operation, 'upsert');
  assert.equal(frame.runtimeSessionId, 'runtime-1');
  assert.equal(frame.providerSessionId, 'provider-1');
  assert.equal(frame.content[2].type, 'tool_use');
  assert.equal(frame.content[2].toolUseId, 'toolu_1');
  assert.equal(frame.runtime?.retry?.nextRetryMs, 8000);
  assert.deepEqual(frame.meta?.raw, { provider_field: 'kept' });
});

test('normalizeSessionFrame rejects legacy snake_case identity fields', () => {
  assert.throws(
    () =>
      normalizeSessionFrame({
        stream_id: 'legacy',
        frame_id: 'legacy',
        provider: 'claude',
        runtime_session_id: 'runtime-1',
        seq: 1,
        kind: 'message',
        content: [],
      }),
    /streamId/,
  );
});

test('SessionFrame type exposes UI-required fields without meta', () => {
  const frame: SessionFrame = {
    streamId: 'deepseek-runtime',
    frameId: 'deepseek-1',
    provider: 'deepseek',
    runtimeSessionId: 'runtime-deepseek',
    providerSessionId: 'provider-deepseek',
    seq: 1,
    timestamp: '2026-05-23T08:00:03Z',
    kind: 'delta',
    role: 'assistant',
    content: [{ type: 'text', text: 'delta' }],
    meta: { raw: { metadata: { model: 'deepseek-chat' } } },
  };

  assert.equal(frame.streamId, 'deepseek-runtime');
  assert.equal(frame.content[0].type, 'text');
});
