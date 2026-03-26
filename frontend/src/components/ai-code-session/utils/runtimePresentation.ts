import type {
  ClaudeRuntimeStateSnapshot,
  SessionRuntimeRetryState,
  SessionRuntimeViewState,
} from '../types';

interface RuntimePresentationMessage {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  error?: unknown;
  duration_ms?: number;
  debug_meta?: {
    runtime_state?: ClaudeRuntimeStateSnapshot | null;
  } | null;
  message?: {
    content?: Array<{ type?: string; name?: string }>;
  } | null;
}

export interface RuntimeStatusCopy {
  tone: SessionRuntimeViewState['severity'];
  primary: string;
  secondary: string | null;
  chips: string[];
}

export function describeRuntimeStatus(state: SessionRuntimeViewState, now: number = state.lastUpdatedAt ?? Date.now()): RuntimeStatusCopy {
  const chips: string[] = [];

  if (state.phase === 'tool_running' && state.activeTool) {
    chips.push(`Tool · ${state.activeTool}`);
  }

  const waitingReasonChip = state.phase === 'waiting' ? formatWaitingReasonChip(state.waitingReason) : null;
  if (waitingReasonChip) {
    chips.push(waitingReasonChip);
  }

  if (state.rateLimited) {
    chips.push('Rate limited');
  }

  if (state.retry) {
    chips.push(`Retry ${formatRetryChip(state.retry)}`);
  }

  if (state.transportState !== 'connected') {
    chips.push(`Transport · ${state.transportState}`);
  }

  const updatedChip = formatUpdatedChip(state.lastUpdatedAt, now);
  if (updatedChip) {
    chips.push(updatedChip);
  }

  if (state.isStuckLikely) {
    chips.push('Possibly stuck');
  }

  return {
    tone: state.severity,
    primary: state.label,
    secondary: state.detail,
    chips,
  };
}

export function summarizeRuntimeMessage(message: RuntimePresentationMessage): string | null {
  if ((message.type === 'system' && message.subtype === 'error') || message.type === 'error' || message.is_error || message.error) {
    const detail = coerceErrorText(message.error);
    return detail ? `Failed · ${detail}` : 'Failed';
  }

  if (message.type === 'system' && message.subtype === 'init') {
    return 'Runtime: Claude session ready';
  }

  const snapshot = message.debug_meta?.runtime_state ?? null;
  if (snapshot?.active_tool?.trim()) {
    const summaryParts = [`Runtime: ${snapshot.active_tool.trim()}`];
    const progress = formatToolProgress(snapshot);
    if (progress) {
      summaryParts.push(progress);
    }
    return summaryParts.join(' · ');
  }

  if (snapshot?.rate_limited) {
    const retry = snapshot.last_api_retry;
    const retryPart = retry?.retry_after_ms ? `retry in ${formatDurationMs(retry.retry_after_ms)}` : null;
    return ['Runtime: rate limit wait', retryPart].filter(Boolean).join(' · ');
  }

  if (snapshot?.retrying) {
    const retry = snapshot.last_api_retry;
    const retryPart = retry?.attempt && retry?.max_attempts ? `attempt ${retry.attempt}/${retry.max_attempts}` : null;
    return ['Runtime: retrying', retryPart].filter(Boolean).join(' · ');
  }

  if (message.type === 'result') {
    const parts = ['Completed'];
    if (message.subtype) {
      parts.push(message.subtype);
    }
    if (typeof message.duration_ms === 'number') {
      parts.push(formatSeconds(message.duration_ms));
    }
    return parts.join(' · ');
  }

  return null;
}

function formatRetryChip(retry: SessionRuntimeRetryState): string {
  if (retry.attempt > 0 && retry.maxAttempts > 0) {
    return `${retry.attempt}/${retry.maxAttempts}`;
  }
  if (retry.retryAfterMs > 0) {
    return formatDurationMs(retry.retryAfterMs);
  }
  return 'scheduled';
}

function formatWaitingReasonChip(reason: SessionRuntimeViewState['waitingReason']): string | null {
  switch (reason) {
    case 'init':
      return 'Waiting · init';
    case 'tool':
      return 'Waiting · tool';
    case 'retry':
      return 'Waiting · retry';
    case 'rate_limit':
      return 'Waiting · rate limit';
    case 'reconnect':
      return 'Waiting · reconnect';
    case 'recovery':
      return 'Waiting · recovery';
    case 'model':
      return 'Waiting · model';
    case 'result':
      return 'Waiting · tool result';
    default:
      return null;
  }
}

function formatUpdatedChip(lastUpdatedAt: number | null, now: number): string | null {
  if (!lastUpdatedAt || now <= lastUpdatedAt) {
    return null;
  }

  const deltaMs = now - lastUpdatedAt;
  if (deltaMs < 1_000) {
    return 'Updated · just now';
  }

  return `Updated · ${formatRelativeDuration(deltaMs)} ago`;
}

function formatToolProgress(snapshot: ClaudeRuntimeStateSnapshot | null): string | null {
  const progress = snapshot?.active_tool_progress;
  if (!progress) return null;

  const parts: string[] = [];
  if (progress.description) {
    parts.push(progress.description);
  }

  const metrics: string[] = [];
  if (typeof progress.step === 'number' && typeof progress.total_steps === 'number' && progress.total_steps > 0) {
    metrics.push(`${progress.step}/${progress.total_steps}`);
  }
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    metrics.push(`${Math.round(progress.percent)}%`);
  }

  if (metrics.length > 0) {
    parts.push(`(${metrics.join(' · ')})`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function coerceErrorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

function formatDurationMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return remainSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainSeconds}s`;
}

function formatRelativeDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
