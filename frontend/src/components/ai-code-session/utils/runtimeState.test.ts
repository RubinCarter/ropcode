import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./runtimeState.ts');
  } catch (error) {
    assert.fail(`runtimeState module not implemented: ${error}`);
  }
}

test('derives tool-running phase from active tool progress', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 20_000,
    tracker: {
      snapshot: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Bash',
        active_tool_progress: {
          tool_name: 'Bash',
          step: 2,
          total_steps: 4,
          percent: 50,
          description: 'Running tests',
        },
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: '',
      },
      systemInitReceived: true,
      lastUpdatedAt: 18_000,
      lastEventAt: 18_000,
      lastEventType: 'assistant',
      lastEventSubtype: 'tool_use',
      lastTextGrowthAt: null,
      lastPartialTextLength: 0,
      lastToolChangeAt: 18_000,
      lastToolResultAt: null,
      lastResultAt: null,
      lastErrorAt: null,
    },
    local: {
      isLoading: true,
      interactiveSessionId: 'interactive-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(state.phase, 'tool_running');
  assert.equal(state.label, 'Executing Bash');
  assert.equal(state.activeTool, 'Bash');
  assert.equal(state.toolProgressText, 'Running tests (2/4 · 50%)');
  assert.equal(state.waitingReason, 'tool');
  assert.equal(state.isStuckLikely, false);
});

test('prioritizes rate-limited over other active phases', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 31_000,
    tracker: {
      snapshot: {
        processing: true,
        retrying: true,
        rate_limited: true,
        active_tool: 'Read',
        active_tool_progress: null,
        last_api_retry: {
          reason: 'rate_limit',
          attempt: 2,
          max_attempts: 5,
          retry_after_ms: 8_000,
          error_status: 429,
        },
        last_thinking_phase: 'thinking',
        last_partial_text_length: 12,
        last_event_type: 'system',
        last_event_subtype: 'retry',
      },
      systemInitReceived: true,
      lastUpdatedAt: 30_000,
      lastEventAt: 30_000,
      lastEventType: 'system',
      lastEventSubtype: 'retry',
      lastTextGrowthAt: 28_000,
      lastPartialTextLength: 12,
      lastToolChangeAt: 27_000,
      lastToolResultAt: null,
      lastResultAt: null,
      lastErrorAt: null,
    },
    local: {
      isLoading: true,
      interactiveSessionId: 'interactive-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(state.phase, 'rate_limited');
  assert.equal(state.severity, 'warning');
  assert.equal(state.rateLimited, true);
  assert.equal(state.retry?.attempt, 2);
  assert.match(state.detail || '', /8s/);
  assert.equal(state.isStuckLikely, false);
});

test('shows initializing before system init arrives', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 12_500,
    tracker: {
      snapshot: null,
      systemInitReceived: false,
      lastUpdatedAt: null,
      lastEventAt: null,
      lastEventType: null,
      lastEventSubtype: null,
      lastTextGrowthAt: null,
      lastPartialTextLength: 0,
      lastToolChangeAt: null,
      lastToolResultAt: null,
      lastResultAt: null,
      lastErrorAt: null,
    },
    local: {
      isLoading: true,
      interactiveSessionId: null,
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 0,
    },
  });

  assert.equal(state.phase, 'initializing');
  assert.equal(state.waitingReason, 'init');
  assert.equal(state.isStuckLikely, true);
  assert.match(state.detail || '', /slow/i);
});

test('does not mark initialization slow before 10 seconds of loading elapsed', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 1_000_000,
    tracker: {
      snapshot: null,
      systemInitReceived: false,
      lastUpdatedAt: null,
      lastEventAt: null,
      lastEventType: null,
      lastEventSubtype: null,
      lastTextGrowthAt: null,
      lastPartialTextLength: 0,
      lastToolChangeAt: null,
      lastToolResultAt: null,
      lastResultAt: null,
      lastErrorAt: null,
    },
    local: {
      isLoading: true,
      interactiveSessionId: null,
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 995_500,
    },
  });

  assert.equal(state.phase, 'initializing');
  assert.equal(state.isStuckLikely, false);
  assert.equal(state.detail, 'Waiting for Claude session ready');
});


test('flags stuck tool execution when tool state is stale without retry delay', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 45_000,
    tracker: {
      snapshot: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Bash',
        active_tool_progress: {
          tool_name: 'Bash',
          step: 1,
          total_steps: 1,
          percent: 100,
          description: 'Running command',
        },
        last_thinking_phase: '',
        last_partial_text_length: 12,
        last_event_type: 'assistant',
        last_event_subtype: 'tool_use',
      },
      systemInitReceived: true,
      lastUpdatedAt: 20_000,
      lastEventAt: 20_000,
      lastEventType: 'assistant',
      lastEventSubtype: 'tool_use',
      lastTextGrowthAt: 20_000,
      lastPartialTextLength: 12,
      lastToolChangeAt: 20_000,
      lastToolResultAt: null,
      lastResultAt: null,
      lastErrorAt: null,
    },
    local: {
      isLoading: true,
      interactiveSessionId: 'interactive-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(state.phase, 'tool_running');
  assert.equal(state.isStuckLikely, true);
  assert.match(state.detail || '', /stuck/i);
});

test('reduces runtime tracker across init to tool to result sequence', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker } = await loadModule();

  let tracker = createInitialRuntimeTracker();

  tracker = reduceRuntimeTracker(tracker, {
    type: 'system',
    subtype: 'init',
    debug_meta: {
      runtime_state: {
        processing: false,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'system',
        last_event_subtype: 'init',
      },
    },
  }, 1_000);

  tracker = reduceRuntimeTracker(tracker, {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read' }] },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Read',
        active_tool_progress: {
          tool_name: 'Read',
          step: 1,
          total_steps: 2,
          percent: 50,
          description: 'Inspecting file',
        },
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: 'tool_use',
      },
    },
  }, 2_000);

  tracker = reduceRuntimeTracker(tracker, {
    type: 'result',
    subtype: 'success',
    debug_meta: {
      runtime_state: {
        processing: false,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'result',
        last_event_subtype: 'success',
      },
    },
  }, 3_000);

  assert.equal(tracker.systemInitReceived, true);
  assert.equal(tracker.lastToolChangeAt, 2_000);
  assert.equal(tracker.lastResultAt, 3_000);
  assert.equal(tracker.lastEventType, 'result');
  assert.equal(tracker.snapshot?.last_event_type, 'result');
  assert.equal(tracker.snapshot?.active_tool, '');
});
