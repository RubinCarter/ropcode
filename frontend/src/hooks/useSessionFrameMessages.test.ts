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
