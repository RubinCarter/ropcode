import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  try {
    return await import('./runtimeState');
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

test('prioritizes compacting over generic thinking while Claude is summarizing context', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 31_000,
    tracker: {
      snapshot: {
        processing: true,
        retrying: false,
        rate_limited: false,
        status: 'compacting',
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: 'thinking',
        last_partial_text_length: 120,
        last_event_type: 'system',
        last_event_subtype: 'status',
      },
      systemInitReceived: true,
      lastUpdatedAt: 30_000,
      lastEventAt: 30_000,
      lastEventType: 'system',
      lastEventSubtype: 'status',
      lastTextGrowthAt: 28_000,
      lastPartialTextLength: 120,
      lastToolChangeAt: null,
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

  assert.equal(state.phase, 'compacting');
  assert.equal(state.label, 'Compacting context');
  assert.equal(state.detail, 'Summarizing previous conversation');
  assert.equal(state.waitingReason, 'model');
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

test('existing interactive sessions wait for model output instead of reinitializing after tracker reset', async () => {
  const { deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 25_000,
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
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 0,
    },
  });

  assert.equal(state.phase, 'waiting');
  assert.equal(state.waitingReason, 'model');
  assert.equal(state.label, 'Waiting');
  assert.doesNotMatch(state.detail || '', /initialization/i);
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

test('result messages without runtime snapshots clear stale active tool state', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

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
    message: { content: [{ type: 'tool_use', name: 'Bash' }] },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Bash',
        active_tool_progress: {
          tool_name: 'Bash',
          description: 'Running command',
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
  }, 3_000);

  const state = deriveRuntimeViewState({
    now: 3_000,
    tracker,
    local: {
      isLoading: false,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(tracker.snapshot?.processing, false);
  assert.equal(tracker.snapshot?.active_tool, '');
  assert.equal(state.phase, 'completed');
  assert.equal(state.activeTool, null);
});

test('assistant end_turn messages without runtime snapshots clear stale active tool state', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

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
    message: { content: [{ type: 'tool_use', name: 'Bash' }] },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Bash',
        active_tool_progress: {
          tool_name: 'Bash',
          description: 'Running command',
        },
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: 'tool_use',
      },
    },
  }, 2_000);
  tracker = reduceRuntimeTracker(tracker, {
    type: 'assistant',
    message: { stop_reason: 'end_turn', content: [{ type: 'text' }] },
  }, 3_000);

  const state = deriveRuntimeViewState({
    now: 3_000,
    tracker,
    local: {
      isLoading: false,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(tracker.snapshot?.processing, false);
  assert.equal(tracker.snapshot?.active_tool, '');
  assert.equal(tracker.lastResultAt, 3_000);
  assert.equal(state.phase, 'completed');
  assert.equal(state.activeTool, null);
});

test('background task-scoped tool results do not mark foreground waiting after tool result', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  const tracker = reduceRuntimeTracker(createInitialRuntimeTracker(), {
    type: 'user',
    ropcode_scope: 'background_task',
    ropcode_task_id: 'agent-1',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tooluse_agent',
          content: '<task-notification><status>completed</status></task-notification>',
        },
      ],
    },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'user',
        last_event_subtype: '',
      },
    },
  } as any, 5_000);

  const state = deriveRuntimeViewState({
    now: 5_000,
    tracker,
    local: {
      isLoading: false,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(tracker.lastToolResultAt, null);
  assert.equal(state.phase, 'idle');
  assert.notEqual(state.detail, 'Waiting for Claude after tool result');
});

test('assistant end_turn clears waiting state after async agent launch tool result', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  let tracker = createInitialRuntimeTracker();
  tracker = reduceRuntimeTracker(tracker, {
    type: 'assistant',
    message: {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'Agent' }],
    },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: 'Agent',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: '',
      },
    },
  } as any, 1_000);

  tracker = reduceRuntimeTracker(tracker, {
    type: 'user',
    ropcode_scope: 'background_task',
    ropcode_task_id: 'agent-1',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'tooluse_agent' }],
    },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'user',
        last_event_subtype: '',
      },
    },
  } as any, 2_000);

  tracker = reduceRuntimeTracker(tracker, {
    type: 'assistant',
    message: {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '后台代理已启动。' }],
    },
    debug_meta: {
      runtime_state: {
        processing: false,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 6,
        last_event_type: 'assistant',
        last_event_subtype: '',
      },
    },
  } as any, 3_000);

  const state = deriveRuntimeViewState({
    now: 3_000,
    tracker,
    local: {
      isLoading: false,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
    },
  });

  assert.equal(tracker.lastToolResultAt, null);
  assert.equal(tracker.lastResultAt, 3_000);
  assert.equal(state.phase, 'completed');
  assert.notEqual(state.detail, 'Waiting for Claude after tool result');
});

test('assistant end_turn overrides stale local loading state', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  let tracker = createInitialRuntimeTracker();
  tracker = reduceRuntimeTracker(tracker, {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'tooluse_agent' }],
    },
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'user',
        last_event_subtype: '',
      },
    },
  } as any, 2_000);

  tracker = reduceRuntimeTracker(tracker, {
    type: 'assistant',
    message: {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '后台代理已启动。' }],
    },
    debug_meta: {
      runtime_state: {
        processing: false,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: '',
        last_partial_text_length: 6,
        last_event_type: 'assistant',
        last_event_subtype: '',
      },
    },
  } as any, 3_000);

  const state = deriveRuntimeViewState({
    now: 3_000,
    tracker,
    local: {
      isLoading: true,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 1_000,
    },
  });

  assert.equal(state.phase, 'completed');
  assert.notEqual(state.detail, 'Waiting for Claude after tool result');
});

test('terminal frame runtime overrides stale processing tracker snapshot', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  const tracker = reduceRuntimeTracker(createInitialRuntimeTracker(), {
    type: 'assistant',
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: false,
        rate_limited: false,
        active_tool: '',
        active_tool_progress: null,
        last_thinking_phase: 'thinking',
        last_partial_text_length: 0,
        last_event_type: 'assistant',
        last_event_subtype: '',
      },
    },
  } as any, 1_000);

  const state = deriveRuntimeViewState({
    now: 2_000,
    tracker,
    local: {
      isLoading: true,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 500,
      frameRuntime: { phase: 'completed', waitingOn: null },
      frameLastSeq: 2,
    },
  });

  assert.equal(state.phase, 'completed');
  assert.equal(state.waitingReason, null);
});

test('stale terminal frame runtime does not override a new loading turn', async () => {
  const { createInitialRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  const state = deriveRuntimeViewState({
    now: 6_000,
    tracker: createInitialRuntimeTracker(),
    local: {
      isLoading: true,
      interactiveSessionId: 'runtime-1',
      hasActiveProcess: true,
      transportConnected: true,
      isRecoveringHistory: false,
      isRestoringSession: false,
      stopRequested: false,
      lastTransportConnectAt: null,
      loadingStartedAt: 5_000,
      loadingStartedFrameSeq: 10,
      frameRuntime: { phase: 'completed', waitingOn: null },
      frameLastSeq: 10,
    },
  });

  assert.equal(state.phase, 'waiting');
  assert.equal(state.label, 'Waiting');
  assert.equal(state.waitingReason, 'model');
});

test('does not treat api retry error detail as a failed runtime state', async () => {
  const { createInitialRuntimeTracker, reduceRuntimeTracker, deriveRuntimeViewState } = await loadModule();

  const tracker = reduceRuntimeTracker(createInitialRuntimeTracker(), {
    type: 'system',
    subtype: 'api_retry',
    error: 'rate_limit',
    debug_meta: {
      runtime_state: {
        processing: true,
        retrying: true,
        rate_limited: true,
        active_tool: '',
        active_tool_progress: null,
        last_api_retry: {
          reason: 'rate_limit',
          attempt: 2,
          max_attempts: 5,
          retry_after_ms: 8_000,
          error_status: 429,
        },
        last_thinking_phase: '',
        last_partial_text_length: 0,
        last_event_type: 'system',
        last_event_subtype: 'api_retry',
      },
    },
  }, 10_000);

  assert.equal(tracker.lastErrorAt, null);

  const state = deriveRuntimeViewState({
    now: 10_000,
    tracker,
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
});
