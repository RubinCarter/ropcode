import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionFrame } from '@/lib/session-frame/types';
import { applySessionRuntimeFrame, clearSessionRuntime, getSessionRuntime } from './sessionRuntimeStore';

function frame(overrides: Partial<SessionFrame>): SessionFrame {
  return {
    streamId: 'claude:runtime-1',
    frameId: 'frame-1',
    provider: 'claude',
    runtimeSessionId: 'runtime-1',
    seq: 1,
    kind: 'message',
    role: 'assistant',
    content: [],
    ...overrides,
  };
}

test('sidechain frames do not overwrite root session runtime state', () => {
  clearSessionRuntime('claude:runtime-1');

  applySessionRuntimeFrame(frame({
    frameId: 'root-ready',
    seq: 1,
    runtime: { phase: 'completed' },
  }));

  applySessionRuntimeFrame(frame({
    frameId: 'sidechain-websearch',
    seq: 2,
    sidechain: true,
    agentId: 'agent-1',
    runtime: {
      phase: 'tool_running',
      activeTool: 'WebSearch',
      progressText: 'Searching for Shenzhen weather',
    },
  }));

  const state = getSessionRuntime('claude:runtime-1');
  assert.equal(state.lastSeq, 1);
  assert.equal(state.lastFrameId, 'root-ready');
  assert.equal(state.runtime?.phase, 'completed');
  assert.notEqual(state.runtime?.activeTool, 'WebSearch');
});

test('assistant end_turn frames mark root session runtime completed', () => {
  clearSessionRuntime('claude:runtime-1');

  applySessionRuntimeFrame(frame({
    frameId: 'assistant-end-turn',
    seq: 1,
    kind: 'message',
    role: 'assistant',
    meta: {
      raw: {
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
        },
      },
    },
  }));

  const state = getSessionRuntime('claude:runtime-1');
  assert.equal(state.lastSeq, 1);
  assert.equal(state.runtime?.phase, 'completed');
  assert.equal(state.runtime?.waitingOn, null);
});

test('new non-runtime frames clear stale terminal runtime state', () => {
  clearSessionRuntime('claude:runtime-1');

  applySessionRuntimeFrame(frame({
    frameId: 'turn-one-result',
    seq: 1,
    kind: 'result',
  }));

  applySessionRuntimeFrame(frame({
    frameId: 'turn-two-init',
    seq: 2,
    kind: 'message',
    role: 'user',
  }));

  const state = getSessionRuntime('claude:runtime-1');
  assert.equal(state.lastSeq, 2);
  assert.equal(state.lastFrameId, 'turn-two-init');
  assert.equal(state.runtime, undefined);
});
