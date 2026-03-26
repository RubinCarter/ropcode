import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./stopStatusBubble.ts');
  } catch (error) {
    assert.fail(`stopStatusBubble module not implemented: ${error}`);
  }
}

test('shows stopping bubble while stop is in progress', async () => {
  const { getStopStatusBubbleState } = await loadModule();

  assert.deepEqual(getStopStatusBubbleState({
    isStopping: true,
    lastCompletedAt: null,
    now: 10_000,
  }), {
    visible: true,
    label: 'Stopping',
  });
});

test('keeps stopping bubble visible for 1.5s after completion', async () => {
  const { getStopStatusBubbleState } = await loadModule();

  assert.deepEqual(getStopStatusBubbleState({
    isStopping: false,
    lastCompletedAt: 10_000,
    now: 11_200,
  }), {
    visible: true,
    label: 'Stopping',
  });
});

test('hides stopping bubble after 1.5s cooldown elapses', async () => {
  const { getStopStatusBubbleState } = await loadModule();

  assert.deepEqual(getStopStatusBubbleState({
    isStopping: false,
    lastCompletedAt: 10_000,
    now: 11_501,
  }), {
    visible: false,
    label: null,
  });
});

test('marks stop bubble complete only after stop lifecycle finishes', async () => {
  const { shouldCompleteStopStatusBubble } = await loadModule();

  assert.equal(shouldCompleteStopStatusBubble({
    stopRequested: true,
    isLoading: true,
    interactiveSessionId: null,
  }), false);

  assert.equal(shouldCompleteStopStatusBubble({
    stopRequested: true,
    isLoading: false,
    interactiveSessionId: 'interactive-123',
  }), false);

  assert.equal(shouldCompleteStopStatusBubble({
    stopRequested: true,
    isLoading: false,
    interactiveSessionId: null,
  }), true);

  assert.equal(shouldCompleteStopStatusBubble({
    stopRequested: false,
    isLoading: false,
    interactiveSessionId: null,
  }), false);
});

test('lays out stop bubble above the stop button', async () => {
  const { getStopStatusControlLayoutClassName } = await loadModule();

  assert.equal(
    getStopStatusControlLayoutClassName(),
    'flex flex-col items-center gap-1.5'
  );
});
