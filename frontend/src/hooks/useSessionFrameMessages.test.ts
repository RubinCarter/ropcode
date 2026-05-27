import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionFrame } from '@/lib/session-frame/types';
import { legacyPayloadFromFrame } from './useSessionFrameMessages';

function frame(overrides: Partial<SessionFrame>): SessionFrame {
  return {
    streamId: 'deepseek:runtime-1',
    frameId: 'frame-1',
    provider: 'deepseek',
    runtimeSessionId: 'runtime-1',
    seq: 1,
    kind: 'message',
    role: 'assistant',
    content: [],
    ...overrides,
  };
}

test('legacyPayloadFromFrame preserves delta semantics when raw provider data exists', () => {
  const payload = legacyPayloadFromFrame(frame({
    kind: 'delta',
    content: [{ type: 'text', text: '今' }],
    meta: {
      raw: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '今' }],
        },
      },
    },
  }));

  assert.ok(payload);
  const message = JSON.parse(payload);
  assert.equal(message.type, 'assistant');
  assert.equal(message.is_delta, true);
  assert.equal(message.message.content[0].text, '今');
});

test('legacyPayloadFromFrame overlays runtime identity onto raw provider data', () => {
  const payload = legacyPayloadFromFrame(frame({
    streamId: 'claude:runtime-1',
    provider: 'claude',
    runtimeSessionId: 'runtime-1',
    providerSessionId: 'provider-native-1',
    kind: 'result',
    role: 'assistant',
    runtime: { phase: 'completed' },
    meta: {
      raw: {
        type: 'assistant',
        sessionId: 'provider-native-1',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'done' }],
        },
      },
    },
  }));

  assert.ok(payload);
  const message = JSON.parse(payload);
  assert.equal(message.type, 'assistant');
  assert.equal(message.sessionId, 'provider-native-1');
  assert.equal(message.runtime_session_id, 'runtime-1');
  assert.equal(message.provider, 'claude');
  assert.equal(message.debug_meta.runtime_state.phase, 'completed');
});

test('legacyPayloadFromFrame does not feed sidechain frames into the root message handler', () => {
  const payload = legacyPayloadFromFrame(frame({
    sidechain: true,
    taskId: 'agent-1',
    kind: 'metadata',
    subtype: 'task_notification',
    meta: {
      raw: {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-1',
        status: 'completed',
      },
    },
  }));

  assert.equal(payload, null);
});
