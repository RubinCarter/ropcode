import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./runtimePresentation');
  } catch (error) {
    assert.fail(`runtimePresentation module not implemented: ${error}`);
  }
}

test('builds runtime status copy for active tool execution', async () => {
  const { describeRuntimeStatus, summarizeRuntimeMessage } = await loadModule();

  const status = describeRuntimeStatus({
    phase: 'tool_running',
    label: 'Executing Bash',
    detail: 'Running tests (2/4 · 50%)',
    severity: 'info',
    activeTool: 'Bash',
    toolProgressText: 'Running tests (2/4 · 50%)',
    retry: null,
    rateLimited: false,
    transportState: 'connected',
    waitingReason: 'tool',
    isStuckLikely: false,
    lastUpdatedAt: 123,
  });

  assert.equal(status.tone, 'info');
  assert.equal(status.primary, 'Executing Bash');
  assert.equal(status.secondary, 'Running tests (2/4 · 50%)');
  assert.equal(status.chips[0], 'Tool · Bash');

  const summary = summarizeRuntimeMessage({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Bash' }],
    },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Bash',
        active_tool_progress: {
          tool_name: 'Bash',
          description: 'Running tests',
          step: 2,
          total_steps: 4,
          percent: 50,
        },
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: 'tool_use',
      },
    },
  });

  assert.equal(summary, 'Runtime: Bash · Running tests (2/4 · 50%)');
});

test('builds retry and rate-limit runtime copy', async () => {
  const { describeRuntimeStatus, summarizeRuntimeMessage } = await loadModule();

  const status = describeRuntimeStatus({
    phase: 'rate_limited',
    label: 'Rate limit wait',
    detail: 'Rate limited · attempt 2/5 · next retry in 8s · status 429',
    severity: 'warning',
    activeTool: null,
    toolProgressText: null,
    retry: {
      attempt: 2,
      maxAttempts: 5,
      retryAfterMs: 8000,
      reason: 'rate_limit',
    },
    rateLimited: true,
    transportState: 'connected',
    waitingReason: 'rate_limit',
    isStuckLikely: false,
    lastUpdatedAt: 456,
  });

  assert.equal(status.tone, 'warning');
  assert.equal(status.primary, 'Rate limit wait');
  assert.match(status.secondary || '', /8s/);
  assert.deepEqual(status.chips, ['Rate limited', 'Retry 2/5']);

  const summary = summarizeRuntimeMessage({
    type: 'result',
    subtype: 'success',
    duration_ms: 3200,
    is_error: false,
    result: 'Done',
  });

  assert.equal(summary, 'Completed · success · 3.2s');
});


test('adds waiting reason and updated chips to runtime status copy', async () => {
  const { describeRuntimeStatus } = await loadModule();

  const status = describeRuntimeStatus({
    phase: 'waiting',
    label: 'Waiting',
    detail: 'Waiting for Claude after tool result',
    severity: 'info',
    activeTool: null,
    toolProgressText: null,
    retry: null,
    rateLimited: false,
    transportState: 'connected',
    waitingReason: 'result',
    isStuckLikely: false,
    lastUpdatedAt: 15_000,
  }, 20_000);

  assert.deepEqual(status.chips, ['Waiting · tool result', 'Updated · 5s ago']);
});
