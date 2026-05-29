import type { SessionRuntimeViewState } from '../types';
import type { RuntimeStatusCopy } from './runtimePresentation';
import type { SubagentProgressSummary } from '@/lib/subagentProgress';
import type { TokenUsageTotals } from '../hooks/useSessionMessages';
import { formatCompactNumber } from '@/lib/subagentProgress';
import i18n from '@/lib/i18n';

export type SessionStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export type SessionStatusGlyph = 'idle' | 'thinking' | 'tool' | 'retry' | 'warning' | 'success' | 'error' | 'reconnect' | 'subagents';
export type SessionStatusPriority = 'high' | 'medium' | 'low';

export interface SessionStatusBarItem {
  key: string;
  label: string;
  priority: SessionStatusPriority;
}

export interface SessionStatusPromptConfig {
  provider: string;
  model?: string;
  providerApiId?: string | null;
  thinkingMode?: string;
}

export type SessionThinkingStatus =
  | { state: 'active'; startedAt: number }
  | { state: 'completed'; durationMs: number; completedAt: number }
  | null;

export interface SessionStatusBarModel {
  tone: SessionStatusTone;
  isActive: boolean;
  primary: string;
  secondary: string | null;
  glyph: SessionStatusGlyph;
  metrics: SessionStatusBarItem[];
  mode: SessionStatusPromptConfig;
  hints: SessionStatusBarItem[];
}

export interface BuildSessionStatusBarInput {
  runtime: SessionRuntimeViewState;
  runtimeCopy: RuntimeStatusCopy;
  now: number;
  loadingStartedAt: number | null;
  tokenUsage: TokenUsageTotals;
  subagentProgress: SubagentProgressSummary;
  currentTodoActiveForm?: string | null;
  promptConfig: SessionStatusPromptConfig;
  isLoading: boolean;
  interactiveSessionId: string | null;
  stopVisible: boolean;
  queuedPromptsCount: number;
  thinkingStatus: SessionThinkingStatus;
}

export function buildSessionStatusBarModel(input: BuildSessionStatusBarInput): SessionStatusBarModel {
  const {
    runtime,
    runtimeCopy,
    now,
    loadingStartedAt,
    tokenUsage,
    subagentProgress,
    currentTodoActiveForm,
    promptConfig,
    isLoading,
    stopVisible,
    queuedPromptsCount,
    thinkingStatus,
  } = input;

  const runtimeIsTerminal = runtime.phase === 'completed' || runtime.phase === 'failed' || runtime.phase === 'cancelled';
  const runtimeCanHaveRunningWork = runtime.phase !== 'idle' && !runtimeIsTerminal;
  const active = (isLoading && !runtimeIsTerminal) || stopVisible || runtimeCanHaveRunningWork;
  const hasRunningSubagents = runtime.phase === 'tool_running' && subagentProgress.runningCount > 0;
  const providerLabel = formatProviderLabel(promptConfig.provider);
  const base = getPrimaryState({ runtime, runtimeCopy, stopVisible, hasRunningSubagents, currentTodoActiveForm, providerLabel });
  const metrics: SessionStatusBarItem[] = [];
  const hints: SessionStatusBarItem[] = [];

  const elapsedMs = active ? getElapsedMs({ now, loadingStartedAt, runtime }) : null;
  if (elapsedMs !== null) {
    metrics.push({ key: 'elapsed', label: formatDuration(elapsedMs), priority: 'high' });
  }

  if (tokenUsage.inputTokens > 0) {
    metrics.push({ key: 'input-tokens', label: `↑ ${formatCompactNumber(tokenUsage.inputTokens)}`, priority: 'high' });
  }
  const visibleOutputTokens = tokenUsage.outputTokens + tokenUsage.estimatedOutputTokens;
  if (visibleOutputTokens > 0) {
    const approximate = tokenUsage.outputTokens === 0 && tokenUsage.estimatedOutputTokens > 0 ? '~' : '';
    metrics.push({ key: 'output-tokens', label: `↓ ${approximate}${formatCompactNumber(visibleOutputTokens)}`, priority: 'high' });
  }

  const thinkingLabel = formatThinkingStatus(thinkingStatus, now);
  if (thinkingLabel) {
    metrics.push({ key: 'thinking', label: thinkingLabel, priority: runtime.phase === 'thinking' ? 'high' : 'medium' });
  }

  if (runtime.activeTool) {
    metrics.push({ key: 'tool', label: i18n.t('stream.toolActive', { name: runtime.activeTool }), priority: 'high' });
  }

  if (subagentProgress.subagents.length > 0) {
    const agentParts = [
      hasRunningSubagents ? i18n.t('stream.agentsRunning', { count: subagentProgress.runningCount }) : null,
      subagentProgress.completedCount > 0 ? i18n.t('stream.agentsDone', { count: subagentProgress.completedCount }) : null,
      subagentProgress.failedCount > 0 ? i18n.t('stream.agentsFailed', { count: subagentProgress.failedCount }) : null,
    ].filter(Boolean).join(' · ');

    metrics.push({
      key: 'subagents',
      label: agentParts || i18n.t('stream.agentsTotal', { count: subagentProgress.subagents.length }),
      priority: subagentProgress.failedCount > 0 || hasRunningSubagents ? 'high' : 'low',
    });

    if (subagentProgress.totalToolUseCount > 0) {
      metrics.push({ key: 'subagent-tools', label: i18n.t('stream.toolsCount', { count: formatCompactNumber(subagentProgress.totalToolUseCount) }), priority: 'low' });
    }
    if (subagentProgress.totalTokenCount > 0) {
      metrics.push({ key: 'subagent-tokens', label: i18n.t('stream.agentTokens', { count: formatCompactNumber(subagentProgress.totalTokenCount) }), priority: 'low' });
    }
  }

  if (runtime.retry) {
    metrics.push({ key: 'retry', label: `Retry ${runtime.retry.attempt}/${runtime.retry.maxAttempts}`, priority: 'high' });
    if (runtime.retry.retryAfterMs > 0) {
      metrics.push({ key: 'retry-delay', label: `next in ${formatDuration(runtime.retry.retryAfterMs)}`, priority: 'medium' });
    }
  }

  if (queuedPromptsCount > 0) {
    metrics.push({ key: 'queue', label: `${queuedPromptsCount} queued`, priority: 'medium' });
  }

  if (runtime.isStuckLikely) {
    metrics.push({ key: 'stuck', label: 'No recent updates', priority: 'high' });
  }

  if ((isLoading && !runtimeIsTerminal) || stopVisible || runtimeCanHaveRunningWork) {
    hints.push({ key: 'interrupt', label: 'Stop interrupts current task', priority: 'high' });
  }
  hints.push({ key: 'send', label: '⌘/Ctrl+Enter send', priority: 'low' });

  return {
    tone: strongestTone(base.tone, runtimeCopy.tone),
    isActive: active,
    primary: base.primary,
    secondary: base.secondary ?? runtimeCopy.secondary,
    glyph: base.glyph,
    metrics: dedupeItems(metrics),
    mode: promptConfig,
    hints: dedupeItems(hints),
  };
}

function getPrimaryState({
  runtime,
  runtimeCopy,
  stopVisible,
  hasRunningSubagents,
  currentTodoActiveForm,
  providerLabel,
}: {
  runtime: SessionRuntimeViewState;
  runtimeCopy: RuntimeStatusCopy;
  stopVisible: boolean;
  hasRunningSubagents: boolean;
  currentTodoActiveForm?: string | null;
  providerLabel: string;
}): Pick<SessionStatusBarModel, 'primary' | 'secondary' | 'glyph' | 'tone'> {
  if (stopVisible || runtime.phase === 'cancelled') {
    return { primary: stopVisible ? 'Stopping…' : 'Cancelled', secondary: runtimeCopy.secondary, glyph: 'warning', tone: 'warning' };
  }

  if (runtime.phase === 'reconnecting' || runtime.phase === 'recovering') {
    return { primary: runtime.phase === 'reconnecting' ? 'Reconnecting…' : 'Recovering session…', secondary: runtimeCopy.secondary, glyph: 'reconnect', tone: 'warning' };
  }

  if (runtime.phase === 'rate_limited') {
    return { primary: 'Rate limit wait', secondary: runtimeCopy.secondary, glyph: 'warning', tone: 'warning' };
  }

  if (runtime.phase === 'retrying') {
    return { primary: 'Retrying request…', secondary: runtimeCopy.secondary, glyph: 'retry', tone: 'warning' };
  }

  if (runtime.phase === 'tool_running' && runtime.activeTool) {
    return { primary: `Running ${runtime.activeTool}…`, secondary: runtime.toolProgressText ?? runtimeCopy.secondary, glyph: 'tool', tone: runtime.isStuckLikely ? 'warning' : 'info' };
  }

  if (hasRunningSubagents) {
    return { primary: 'Running subagents…', secondary: runtimeCopy.secondary, glyph: 'subagents', tone: 'info' };
  }

  if (runtime.phase === 'compacting') {
    return { primary: 'Compacting context…', secondary: runtimeCopy.secondary, glyph: 'tool', tone: 'info' };
  }

  if (currentTodoActiveForm && runtime.phase !== 'idle' && runtime.phase !== 'completed' && runtime.phase !== 'failed') {
    return { primary: ensureEllipsis(currentTodoActiveForm), secondary: runtimeCopy.secondary, glyph: 'tool', tone: 'info' };
  }

  if (runtime.phase === 'thinking') {
    return { primary: 'Thinking…', secondary: runtimeCopy.secondary, glyph: 'thinking', tone: runtime.isStuckLikely ? 'warning' : 'info' };
  }

  if (runtime.phase === 'initializing') {
    return { primary: i18n.t('prompt.statusStarting', { provider: providerLabel }), secondary: runtimeCopy.secondary, glyph: 'reconnect', tone: 'info' };
  }

  if (runtime.phase === 'waiting') {
    return { primary: i18n.t('prompt.statusWaitingFor', { provider: providerLabel }), secondary: runtimeCopy.secondary, glyph: 'idle', tone: runtime.isStuckLikely ? 'warning' : 'neutral' };
  }

  if (runtime.phase === 'failed') {
    return { primary: 'Failed', secondary: runtimeCopy.secondary, glyph: 'error', tone: 'error' };
  }

  if (runtime.phase === 'completed') {
    return { primary: 'Completed', secondary: runtimeCopy.secondary, glyph: 'success', tone: 'success' };
  }

  return { primary: 'Ready', secondary: null, glyph: 'idle', tone: 'neutral' };
}

function getElapsedMs({ now, loadingStartedAt, runtime }: { now: number; loadingStartedAt: number | null; runtime: SessionRuntimeViewState }): number | null {
  const startedAt = loadingStartedAt ?? runtime.lastUpdatedAt;
  if (!startedAt || now <= startedAt) return null;
  return now - startedAt;
}

function formatThinkingStatus(thinkingStatus: SessionThinkingStatus, now: number): string | null {
  if (!thinkingStatus) return null;
  if (thinkingStatus.state === 'active') {
    return `thinking ${formatDuration(Math.max(0, now - thinkingStatus.startedAt))}`;
  }
  if (now - thinkingStatus.completedAt <= 2_000) {
    return `thought for ${formatDuration(thinkingStatus.durationMs)}`;
  }
  return null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function ensureEllipsis(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'Working…';
  return /[.…]$/.test(trimmed) ? trimmed : `${trimmed}…`;
}

function formatProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'claude') return 'Claude';
  if (normalized === 'codex') return 'Codex';
  if (normalized === 'deepseek') return 'DeepSeek';
  if (normalized === 'gemini') return 'Gemini';
  if (normalized === 'pi') return 'Pi';
  return provider.trim() || 'model';
}

function strongestTone(first: SessionStatusTone, second: RuntimeStatusCopy['tone']): SessionStatusTone {
  const severity: Record<SessionStatusTone, number> = {
    neutral: 0,
    success: 1,
    info: 2,
    warning: 3,
    error: 4,
  };
  const normalizedSecond: SessionStatusTone = second === 'success' || second === 'warning' || second === 'error' || second === 'info' ? second : 'neutral';
  return severity[normalizedSecond] > severity[first] ? normalizedSecond : first;
}

function dedupeItems(items: SessionStatusBarItem[]): SessionStatusBarItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return Boolean(item.label);
  });
}
