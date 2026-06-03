import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionFrame } from '@/lib/session-frame/types';
import {
  appendSessionFrame,
  clearSessionFrames,
  getSessionFrames,
  getSessionMessages,
  mergeSessionFrames,
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

test('sessionFrameStore keeps project chat context sync after init at the same seq', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'context-sync',
    seq: 0,
    kind: 'message',
    role: 'user',
    subtype: 'projectchat_context_sync',
    content: [{ type: 'text', text: '<previous_conversation />' }],
  }));
  appendSessionFrame(frame({
    frameId: 'init',
    seq: 0,
    kind: 'init',
    role: 'system',
    subtype: 'thread_created',
  }));

  assert.deepEqual(
    getSessionFrames('stream-1').map((item) => item.frameId),
    ['init', 'context-sync'],
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

test('sessionFrameStore upserts streaming frames by message id', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'update-1',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 1,
    content: [{ type: 'text', text: 'hel' }],
  }));
  appendSessionFrame(frame({
    frameId: 'update-2',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 2,
    content: [{ type: 'text', text: 'hello' }],
  }));

  assert.deepEqual(
    getSessionFrames('stream-1').map((item) => item.frameId),
    ['update-2'],
  );
  assert.equal(getSessionMessages('stream-1')[0].id, 'message-1');
  assert.deepEqual(getSessionMessages('stream-1')[0].content, [{ type: 'text', text: 'hello' }]);
});

test('sessionFrameStore accepts upsert updates that reuse the same frame id', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'message-frame',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 1,
    content: [{ type: 'text', text: 'hel' }],
  }));
  appendSessionFrame(frame({
    frameId: 'message-frame',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 2,
    content: [{ type: 'text', text: 'hello' }],
  }));

  assert.deepEqual(
    getSessionFrames('stream-1').map((item) => item.frameId),
    ['message-frame'],
  );
  assert.deepEqual(getSessionMessages('stream-1')[0].content, [{ type: 'text', text: 'hello' }]);
});

test('sessionFrameStore accepts later upsert after a duplicate stable frame id', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'stable-message',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 1,
    content: [{ type: 'text', text: 'partial' }],
  }));
  appendSessionFrame(frame({
    frameId: 'stable-message',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 3,
    content: [{ type: 'text', text: 'complete final reply' }],
  }));

  const frames = getSessionFrames('stream-1');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].seq, 3);
  assert.deepEqual(getSessionMessages('stream-1')[0].content, [{ type: 'text', text: 'complete final reply' }]);
});

test('sessionFrameStore merges history without removing live project chat frames', () => {
  clearSessionFrames('project-chat-1');

  appendSessionFrame(frame({
    streamId: 'project-chat-1',
    frameId: 'live-2',
    seq: 2,
    content: [{ type: 'text', text: 'live reply' }],
  }));

  mergeSessionFrames('project-chat-1', [
    frame({
      streamId: 'project-chat-1',
      frameId: 'history-1',
      seq: 1,
      content: [{ type: 'text', text: 'history reply' }],
    }),
  ]);

  assert.deepEqual(
    getSessionFrames('project-chat-1').map((item) => item.frameId),
    ['history-1', 'live-2'],
  );
  assert.deepEqual(
    getSessionMessages('project-chat-1').map((item) => item.content[0]),
    [
      { type: 'text', text: 'history reply' },
      { type: 'text', text: 'live reply' },
    ],
  );
});

test('sessionFrameStore does not let history merge replace newer live upserts', () => {
  clearSessionFrames('project-chat-1');

  appendSessionFrame(frame({
    streamId: 'project-chat-1',
    frameId: 'stable-message',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 2,
    content: [{ type: 'text', text: 'complete live reply' }],
  }));

  mergeSessionFrames('project-chat-1', [
    frame({
      streamId: 'project-chat-1',
      frameId: 'stable-message',
      messageId: 'message-1',
      operation: 'upsert',
      seq: -1,
      content: [{ type: 'text', text: 'old history reply' }],
    }),
  ]);

  assert.deepEqual(
    getSessionFrames('project-chat-1').map((item) => item.content[0]),
    [{ type: 'text', text: 'complete live reply' }],
  );
});

test('sessionFrameStore lets history merge complete a partial live upsert', () => {
  clearSessionFrames('project-chat-1');

  appendSessionFrame(frame({
    streamId: 'project-chat-1',
    frameId: 'stable-message',
    messageId: 'message-1',
    operation: 'upsert',
    seq: 5,
    content: [{ type: 'text', text: 'partial' }],
  }));

  mergeSessionFrames('project-chat-1', [
    frame({
      streamId: 'project-chat-1',
      frameId: 'stable-message',
      messageId: 'message-1',
      operation: 'upsert',
      seq: -1,
      content: [{ type: 'text', text: 'partial complete reply' }],
    }),
  ]);

  const frames = getSessionFrames('project-chat-1');
  assert.equal(frames[0].seq, 5);
  assert.deepEqual(frames[0].content[0], { type: 'text', text: 'partial complete reply' });
});

test('sessionFrameStore keeps sidechain frames out of root display messages', () => {
  clearSessionFrames('stream-1');

  appendSessionFrame(frame({
    frameId: 'root-1',
    seq: 1,
    content: [{ type: 'text', text: 'root' }],
  }));
  appendSessionFrame(frame({
    frameId: 'task-1',
    seq: 2,
    sidechain: true,
    taskId: 'agent-1',
    content: [{ type: 'system', text: 'completed' }],
  }));

  assert.deepEqual(
    getSessionMessages('stream-1').map((item) => item.frameIds[0]),
    ['root-1'],
  );
  assert.deepEqual(
    getSessionFrames('stream-1').map((item) => item.frameId),
    ['root-1', 'task-1'],
  );
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
