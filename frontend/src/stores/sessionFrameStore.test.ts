import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionFrame } from '@/lib/session-frame/types';
import {
  appendSessionFrame,
  clearSessionFrames,
  getSessionFrames,
  getSessionMessages,
  subscribeSessionFrames,
} from './sessionFrameStore';

function frame(overrides: Partial<SessionFrame>): SessionFrame {
  return {
    streamId: 'stream-1',
    frameId: `frame-${overrides.seq ?? 1}`,
    provider: 'claude',
    runtimeSessionId: 'runtime-1',
    seq: overrides.seq ?? 1,
    kind: 'message',
    role: 'assistant',
    content: [],
    ...overrides,
  };
}

test('sessionFrameStore appends frames in seq order and ignores duplicate frame ids', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({ frameId: 'frame-2', seq: 2 }));
  appendSessionFrame(frame({ frameId: 'frame-1', seq: 1 }));
  appendSessionFrame(frame({ frameId: 'frame-2', seq: 3 }));

  assert.deepEqual(
    getSessionFrames('stream-1').map((item) => item.frameId),
    ['frame-1', 'frame-2'],
  );
});

test('sessionFrameStore coalesces text deltas into stable display messages', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'delta-1',
    seq: 1,
    kind: 'delta',
    role: 'assistant',
    content: [{ type: 'text', text: 'hel' }],
  }));
  appendSessionFrame(frame({
    frameId: 'delta-2',
    seq: 2,
    kind: 'delta',
    role: 'assistant',
    content: [{ type: 'text', text: 'lo' }],
  }));
  appendSessionFrame(frame({
    frameId: 'tool-1',
    seq: 3,
    kind: 'tool',
    role: 'assistant',
    content: [{ type: 'tool_use', toolUseId: 'toolu-1', name: 'Read' }],
  }));

  const messages = getSessionMessages('stream-1');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'assistant');
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'hello' }]);
  assert.equal(messages[1].frameIds[0], 'tool-1');
});

test('sessionFrameStore exposes subscription snapshots for useSyncExternalStore', () => {
  clearSessionFrames('stream-1');

  let notifications = 0;
  const unsubscribe = subscribeSessionFrames('stream-1', () => {
    notifications++;
  });

  appendSessionFrame(frame({ frameId: 'frame-1', seq: 1 }));
  unsubscribe();
  appendSessionFrame(frame({ frameId: 'frame-2', seq: 2 }));

  assert.equal(notifications, 1);
});
