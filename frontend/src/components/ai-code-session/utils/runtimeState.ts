import type {
  ClaudeRuntimeStateSnapshot,
  SessionRuntimeTracker,
  SessionRuntimeViewState,
} from '../types';

interface RuntimeTrackerMessage {
  type?: string;
  subtype?: string;
  debug_meta?: {
    runtime_state?: ClaudeRuntimeStateSnapshot | null;
  } | null;
  message?: {
    content?: Array<{ type?: string; name?: string }>;
  } | null;
  result?: string;
  is_error?: boolean;
  error?: string;
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
  const snapshot = normalizeSnapshot(message.debug_meta?.runtime_state ?? null);
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

  if (message.type === 'user' && Array.isArray(message.message?.content)) {
    const hasToolResult = message.message.content.some((content) => content.type === 'tool_result');
    if (hasToolResult) {
      next.lastToolResultAt = now;
    }
  }

  if (message.type === 'result') {
    next.lastResultAt = now;
  }

  if ((message.type === 'system' && message.subtype === 'error') || message.type === 'error' || message.error || message.is_error) {
    next.lastErrorAt = now;
  }

  return next;
}

export function deriveRuntimeViewState({ tracker, local, now }: DeriveRuntimeViewStateInput): SessionRuntimeViewState {
  const snapshot = tracker.snapshot;
  const retry = getRetryState(snapshot);
  const activeTool = snapshot?.active_tool?.trim() || null;
  const toolProgressText = formatToolProgress(snapshot);
  const transportState = local.transportConnected ? 'connected' : 'reconnecting';
  const loadingElapsedMs = local.isLoading
    ? Math.max(0, now - (local.loadingStartedAt ?? 0))
    : 0;

  let phase: SessionRuntimeViewState['phase'] = 'idle';
  let label = 'Idle';
  let detail: string | null = null;
  let severity: SessionRuntimeViewState['severity'] = 'neutral';
  let waitingReason: SessionRuntimeViewState['waitingReason'] = 'idle';

  if (local.stopRequested && !local.isLoading && local.interactiveSessionId === null) {
    phase = 'cancelled';
    label = 'Cancelled';
    severity = 'warning';
    waitingReason = null;
  } else if (snapshot?.rate_limited) {
    phase = 'rate_limited';
    label = 'Rate limit wait';
    severity = 'warning';
    waitingReason = 'rate_limit';
    detail = formatRetryDetail(snapshot, retry);
  } else if (snapshot?.retrying) {
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
  } else if (local.isRecoveringHistory || local.isRestoringSession) {
    phase = 'recovering';
    label = local.isRestoringSession ? 'Restoring session' : 'Recovering session';
    severity = 'info';
    waitingReason = 'recovery';
    detail = local.isRestoringSession ? 'Loading saved conversation state' : 'Recovering messages after reconnect';
  } else if (local.isLoading && !tracker.systemInitReceived) {
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
  } else if (local.isLoading || snapshot?.processing) {
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
    lastUpdatedAt: tracker.lastUpdatedAt,
  };
}

function normalizeSnapshot(snapshot: ClaudeRuntimeStateSnapshot | null): ClaudeRuntimeStateSnapshot | null {
  if (!snapshot) return null;
  return {
    processing: Boolean(snapshot.processing),
    retrying: Boolean(snapshot.retrying),
    rate_limited: Boolean(snapshot.rate_limited),
    active_tool: snapshot.active_tool || '',
    active_tool_progress: snapshot.active_tool_progress ?? null,
    last_api_retry: snapshot.last_api_retry ?? null,
    last_thinking_phase: snapshot.last_thinking_phase || '',
    last_partial_text_length: snapshot.last_partial_text_length ?? 0,
    last_event_type: snapshot.last_event_type || '',
    last_event_subtype: snapshot.last_event_subtype || '',
  };
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
