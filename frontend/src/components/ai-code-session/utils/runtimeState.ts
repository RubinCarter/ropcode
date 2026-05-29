import type {
  ClaudeRuntimeStateSnapshot,
  SessionRuntimeTracker,
  SessionRuntimeViewState,
} from '../types';
import type { RuntimeSnapshot } from '@/lib/session-frame/types';

interface RuntimeTrackerMessage {
  type?: string;
  subtype?: string;
  ropcode_scope?: string;
  ropcode_task_id?: string;
  debug_meta?: {
    runtime_state?: ClaudeRuntimeStateSnapshot | null;
    ropcode_scope?: string;
    ropcode_task_id?: string;
  } | null;
  message?: {
    content?: Array<{ type?: string; name?: string }>;
    stop_reason?: string;
  } | null;
  result?: string;
  is_error?: boolean;
  error?: string;
  stop_reason?: string;
}

export interface RuntimeLocalState {
  isLoading: boolean;
  interactiveSessionId: string | null;
  hasActiveProcess: boolean;
  transportConnected: boolean;
  isRecoveringHistory: boolean;
  isRestoringSession: boolean;
  stopRequested: boolean;
  lastTransportConnectAt: number | null;
  loadingStartedAt?: number | null;
  loadingStartedFrameSeq?: number | null;
  frameRuntime?: RuntimeSnapshot;
  frameLastSeq?: number;
}

export interface DeriveRuntimeViewStateInput {
  tracker: SessionRuntimeTracker;
  local: RuntimeLocalState;
  now: number;
}

export function createInitialRuntimeTracker(): SessionRuntimeTracker {
  return {
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
  };
}

export function reduceRuntimeTracker(
  tracker: SessionRuntimeTracker,
  message: RuntimeTrackerMessage,
  now: number
): SessionRuntimeTracker {
  const backgroundTaskScoped = isBackgroundTaskScoped(message);
  const explicitSnapshot = normalizeSnapshot(message.debug_meta?.runtime_state ?? null);
  const snapshot = backgroundTaskScoped ? null : (explicitSnapshot ?? terminalSnapshot(message));
  const next: SessionRuntimeTracker = {
    ...tracker,
    snapshot: snapshot ?? tracker.snapshot,
    lastUpdatedAt: snapshot ? now : tracker.lastUpdatedAt,
    lastEventAt: now,
    lastEventType: message.type ?? tracker.lastEventType,
    lastEventSubtype: message.subtype ?? tracker.lastEventSubtype,
  };

  if (message.type === 'system' && message.subtype === 'init') {
    next.systemInitReceived = true;
  }

  const partialTextLength = snapshot?.last_partial_text_length;
  if (typeof partialTextLength === 'number') {
    if (partialTextLength > tracker.lastPartialTextLength) {
      next.lastTextGrowthAt = now;
    }
    next.lastPartialTextLength = partialTextLength;
  }

  const activeTool = snapshot?.active_tool?.trim();
  const prevTool = tracker.snapshot?.active_tool?.trim();
  if (activeTool && activeTool !== prevTool) {
    next.lastToolChangeAt = now;
  }

  if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
    const toolUse = message.message?.content.find((content) => content.type === 'tool_use');
    if (toolUse?.name) {
      next.lastToolChangeAt = now;
    }
  }

  if (!backgroundTaskScoped && message.type === 'user' && Array.isArray(message.message?.content)) {
    const hasToolResult = message.message.content.some((content) => content.type === 'tool_result');
    if (hasToolResult) {
      next.lastToolResultAt = now;
    }
  }

  if (message.type === 'result' || isAssistantEndTurn(message)) {
    next.lastResultAt = now;
  }

  if (
    (message.type === 'system' && message.subtype === 'error') ||
    message.type === 'error' ||
    (message.subtype !== 'api_retry' && (message.error || message.is_error))
  ) {
    next.lastErrorAt = now;
  }

  return next;
}

function isBackgroundTaskScoped(message: RuntimeTrackerMessage): boolean {
  return message.ropcode_scope === 'background_task' || message.debug_meta?.ropcode_scope === 'background_task';
}

export function deriveRuntimeViewState({ tracker, local, now }: DeriveRuntimeViewStateInput): SessionRuntimeViewState {
  const loadingIsTerminatedByTurn = Boolean(
    tracker.lastResultAt &&
    (!local.loadingStartedAt || tracker.lastResultAt >= local.loadingStartedAt)
  );
  const effectiveIsLoading = local.isLoading && !loadingIsTerminatedByTurn;
  const loadingElapsedMs = effectiveIsLoading
    ? Math.max(0, now - (local.loadingStartedAt ?? 0))
    : 0;
  const frameRuntimeBelongsToCurrentTurn = !effectiveIsLoading ||
    local.loadingStartedFrameSeq === undefined ||
    local.loadingStartedFrameSeq === null ||
    typeof local.frameLastSeq !== 'number' ||
    local.frameLastSeq > local.loadingStartedFrameSeq;
  const currentFrameRuntime = frameRuntimeBelongsToCurrentTurn
    ? local.frameRuntime
    : undefined;
  const snapshot = tracker.snapshot ?? snapshotFromFrameRuntime(currentFrameRuntime ?? null);
  const retry = getRetryState(snapshot);
  const activeTool = snapshot?.active_tool?.trim() || null;
  const toolProgressText = formatToolProgress(snapshot);
  const transportState = local.transportConnected ? 'connected' : 'reconnecting';

  // If we have evidence of recent activity (text growth or tool change) AFTER
  // the last snapshot update, the snapshot's rate_limited/retrying flags are stale.
  const snapshotIsStale = Boolean(
    tracker.lastUpdatedAt &&
    ((tracker.lastTextGrowthAt && tracker.lastTextGrowthAt > tracker.lastUpdatedAt) ||
     (tracker.lastToolChangeAt && tracker.lastToolChangeAt > tracker.lastUpdatedAt))
  );

  let phase: SessionRuntimeViewState['phase'] = 'idle';
  let label = 'Idle';
  let detail: string | null = null;
  let severity: SessionRuntimeViewState['severity'] = 'neutral';
  let waitingReason: SessionRuntimeViewState['waitingReason'] = 'idle';

  if (local.stopRequested && !effectiveIsLoading && local.interactiveSessionId === null) {
    phase = 'cancelled';
    label = 'Cancelled';
    severity = 'warning';
    waitingReason = null;
  } else if (snapshot?.rate_limited && !snapshotIsStale) {
    phase = 'rate_limited';
    label = 'Rate limit wait';
    severity = 'warning';
    waitingReason = 'rate_limit';
    detail = formatRetryDetail(snapshot, retry);
  } else if (snapshot?.retrying && !snapshotIsStale) {
    phase = 'retrying';
    label = 'Retrying';
    severity = 'warning';
    waitingReason = 'retry';
    detail = formatRetryDetail(snapshot, retry);
  } else if (!local.transportConnected) {
    phase = 'reconnecting';
    label = 'Reconnecting';
    severity = 'warning';
    waitingReason = 'reconnect';
    detail = 'Waiting for WebSocket reconnection';
  } else if (currentFrameRuntime?.phase === 'failed') {
    phase = 'failed';
    label = 'Failed';
    severity = 'error';
    waitingReason = null;
    detail = currentFrameRuntime.waitingOn ?? null;
  } else if (currentFrameRuntime?.phase === 'completed') {
    phase = 'completed';
    label = 'Completed';
    severity = 'success';
    waitingReason = null;
    detail = currentFrameRuntime.waitingOn ?? null;
  } else if (snapshot?.status === 'compacting') {
    phase = 'compacting';
    label = 'Compacting context';
    severity = 'info';
    waitingReason = 'model';
    detail = 'Summarizing previous conversation';
  } else if (local.isRecoveringHistory || local.isRestoringSession) {
    phase = 'recovering';
    label = local.isRestoringSession ? 'Restoring session' : 'Recovering session';
    severity = 'info';
    waitingReason = 'recovery';
    detail = local.isRestoringSession ? 'Loading saved conversation state' : 'Recovering messages after reconnect';
  } else if (effectiveIsLoading && !tracker.systemInitReceived && !local.interactiveSessionId) {
    phase = 'initializing';
    label = 'Initializing';
    severity = 'info';
    waitingReason = 'init';
    detail = loadingElapsedMs >= 10_000 ? 'Initialization is slow' : 'Waiting for Claude session ready';
  } else if (activeTool) {
    phase = 'tool_running';
    label = `Executing ${activeTool}`;
    severity = 'info';
    waitingReason = 'tool';
    detail = toolProgressText;
  } else if (snapshot?.last_thinking_phase || (snapshot?.processing && tracker.lastTextGrowthAt !== null)) {
    phase = 'thinking';
    label = 'Thinking';
    severity = 'info';
    waitingReason = 'model';
    detail = 'Waiting for model output';
  } else if (effectiveIsLoading || snapshot?.processing) {
    phase = 'waiting';
    label = 'Waiting';
    severity = 'info';
    waitingReason = tracker.lastToolResultAt ? 'result' : 'model';
    detail = tracker.lastToolResultAt ? 'Waiting for Claude after tool result' : 'Waiting for model output';
  } else if (tracker.lastEventType === 'result' && tracker.lastEventSubtype === 'cancelled') {
    phase = 'cancelled';
    label = 'Cancelled';
    severity = 'warning';
    waitingReason = null;
  } else if (tracker.lastErrorAt && (!tracker.lastResultAt || tracker.lastErrorAt >= tracker.lastResultAt)) {
    phase = 'failed';
    label = 'Failed';
    severity = 'error';
    waitingReason = null;
  } else if (tracker.lastResultAt) {
    phase = 'completed';
    label = 'Completed';
    severity = 'success';
    waitingReason = null;
    detail = formatResultDetail(snapshot);
  }

  const isStuckLikely = computeStuckLikely({ phase, tracker, snapshot, now, loadingElapsedMs });
  if (isStuckLikely && phase === 'tool_running') {
    detail = `Possible stuck in ${activeTool}`;
  } else if (isStuckLikely && phase === 'initializing') {
    detail = 'Initialization is slow';
  } else if (isStuckLikely && (phase === 'thinking' || phase === 'waiting')) {
    detail = 'Waiting for model output, possibly stuck';
  }

  return {
    phase,
    label,
    detail,
    severity,
    activeTool,
    toolProgressText,
    retry,
    rateLimited: Boolean(snapshot?.rate_limited),
    transportState,
    waitingReason,
    isStuckLikely,
    lastUpdatedAt: tracker.lastUpdatedAt ?? (local.frameLastSeq ? now : null),
  };
}

function snapshotFromFrameRuntime(runtime: RuntimeSnapshot | null): ClaudeRuntimeStateSnapshot | null {
  if (!runtime) return null;
  return {
    processing: runtime.phase === 'thinking' || runtime.phase === 'tool_running' || runtime.phase === 'waiting',
    retrying: Boolean(runtime.retry),
    rate_limited: Boolean(runtime.rateLimit),
    status: runtime.phase || '',
    active_tool: runtime.activeTool || '',
    active_tool_progress: runtime.progressText ? { description: runtime.progressText } : null,
    last_api_retry: runtime.retry ? {
      attempt: runtime.retry.attempt ?? 0,
      max_attempts: runtime.retry.maxAttempts ?? 0,
      retry_after_ms: runtime.retry.nextRetryMs ?? 0,
    } : null,
    last_thinking_phase: runtime.phase === 'thinking' ? 'thinking' : '',
    last_partial_text_length: 0,
    last_event_type: runtime.phase,
    last_event_subtype: '',
  };
}

function normalizeSnapshot(snapshot: ClaudeRuntimeStateSnapshot | null): ClaudeRuntimeStateSnapshot | null {
  if (!snapshot) return null;
  return {
    processing: Boolean(snapshot.processing),
    retrying: Boolean(snapshot.retrying),
    rate_limited: Boolean(snapshot.rate_limited),
    status: snapshot.status || '',
    active_tool: snapshot.active_tool || '',
    active_tool_progress: snapshot.active_tool_progress ?? null,
    last_api_retry: snapshot.last_api_retry ?? null,
    last_thinking_phase: snapshot.last_thinking_phase || '',
    last_partial_text_length: snapshot.last_partial_text_length ?? 0,
    last_event_type: snapshot.last_event_type || '',
    last_event_subtype: snapshot.last_event_subtype || '',
  };
}

function terminalSnapshot(message: RuntimeTrackerMessage): ClaudeRuntimeStateSnapshot | null {
  const assistantEndTurn = isAssistantEndTurn(message);
  if (message.type !== 'result' && !assistantEndTurn) return null;
  const status = assistantEndTurn ? 'completed' : (message.subtype || (message.is_error ? 'failed' : 'completed'));
  const eventType = assistantEndTurn ? 'assistant' : 'result';
  const eventSubtype = assistantEndTurn ? 'end_turn' : (message.subtype || (message.is_error ? 'failed' : 'success'));
  return {
    processing: false,
    retrying: false,
    rate_limited: false,
    status,
    active_tool: '',
    active_tool_progress: null,
    last_api_retry: null,
    last_thinking_phase: '',
    last_partial_text_length: 0,
    last_event_type: eventType,
    last_event_subtype: eventSubtype,
  };
}

function isAssistantEndTurn(message: RuntimeTrackerMessage): boolean {
  return message.type === 'assistant' &&
    (message.message?.stop_reason === 'end_turn' || message.stop_reason === 'end_turn');
}

function getRetryState(snapshot: ClaudeRuntimeStateSnapshot | null): SessionRuntimeViewState['retry'] {
  if (!snapshot?.retrying) return null;
  const retry = snapshot?.last_api_retry;
  if (!retry) return null;
  return {
    attempt: retry.attempt ?? 0,
    maxAttempts: retry.max_attempts ?? 0,
    retryAfterMs: retry.retry_after_ms ?? 0,
    reason: retry.reason,
  };
}

function formatToolProgress(snapshot: ClaudeRuntimeStateSnapshot | null): string | null {
  const progress = snapshot?.active_tool_progress;
  if (!progress) return null;

  const parts: string[] = [];
  if (progress.description) {
    parts.push(progress.description);
  }

  const progressBits: string[] = [];
  if (typeof progress.step === 'number' && typeof progress.total_steps === 'number' && progress.total_steps > 0) {
    progressBits.push(`${progress.step}/${progress.total_steps}`);
  }
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    progressBits.push(`${Math.round(progress.percent)}%`);
  }

  if (progressBits.length > 0) {
    parts.push(`(${progressBits.join(' · ')})`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function formatRetryDetail(snapshot: ClaudeRuntimeStateSnapshot | null, retry: SessionRuntimeViewState['retry']): string | null {
  if (!retry) return null;
  const pieces: string[] = [];
  if (retry.reason === 'rate_limit') {
    pieces.push('Rate limited');
  } else if (retry.reason) {
    pieces.push(`Retrying after ${retry.reason}`);
  } else {
    pieces.push('Retry scheduled');
  }

  if (retry.attempt > 0 && retry.maxAttempts > 0) {
    pieces.push(`attempt ${retry.attempt}/${retry.maxAttempts}`);
  }
  if (retry.retryAfterMs > 0) {
    pieces.push(`next retry in ${formatDurationMs(retry.retryAfterMs)}`);
  }
  if (snapshot?.last_api_retry?.error_status) {
    pieces.push(`status ${snapshot.last_api_retry.error_status}`);
  }

  return pieces.join(' · ');
}

function formatResultDetail(snapshot: ClaudeRuntimeStateSnapshot | null): string | null {
  const subtype = snapshot?.last_event_subtype?.trim();
  if (!subtype) return null;
  return `Result: ${subtype}`;
}

function computeStuckLikely({
  phase,
  tracker,
  snapshot,
  now,
  loadingElapsedMs,
}: {
  phase: SessionRuntimeViewState['phase'];
  tracker: SessionRuntimeTracker;
  snapshot: ClaudeRuntimeStateSnapshot | null;
  now: number;
  loadingElapsedMs: number;
}): boolean {
  if (snapshot?.last_api_retry?.retry_after_ms) {
    return false;
  }

  if (phase === 'initializing') {
    return loadingElapsedMs >= 10_000;
  }

  if (phase === 'tool_running' && tracker.lastToolChangeAt) {
    return now - tracker.lastToolChangeAt >= 20_000 && now - (tracker.lastEventAt ?? tracker.lastToolChangeAt) >= 20_000;
  }

  if ((phase === 'thinking' || phase === 'waiting') && tracker.lastEventAt) {
    const baseline = Math.max(tracker.lastTextGrowthAt ?? 0, tracker.lastEventAt);
    return baseline > 0 && now - baseline >= 15_000;
  }

  return false;
}

function formatDurationMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (remainSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainSeconds}s`;
}
