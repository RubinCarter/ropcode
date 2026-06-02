import test from 'node:test';
import assert from 'node:assert/strict';
import { projectChatExistingSessionId, projectChatSegmentFromSwitchResult } from './projectChatSession';

test('projectChatExistingSessionId prefers provider-native session ids', () => {
  assert.equal(
    projectChatExistingSessionId({
      id: 'history-id',
      session_id: 'runtime-id',
      provider_session_id: 'provider-id',
    }),
    'provider-id',
  );
});

test('projectChatExistingSessionId falls back to historical id', () => {
  assert.equal(
    projectChatExistingSessionId({
      id: 'history-id',
      provider: 'codex',
    }),
    'history-id',
  );
});

test('projectChatSegmentFromSwitchResult normalizes empty runtime sessions', () => {
  const segment = projectChatSegmentFromSwitchResult({
    chat_id: 'chat-1',
    segment_id: 'segment-1',
    runtime_session_id: '',
    stream_id: 'chat-1',
    provider: 'codex',
    model: 'gpt-5',
  }, 'claude', 'sonnet', 2);

  assert.deepEqual(segment, {
    id: 'segment-1',
    provider: 'codex',
    model: 'gpt-5',
    runtimeSessionId: '',
    streamId: 'chat-1',
    seq: 2,
  });
});
