/**
 * Runtime tracker store — keyed by session identifier (typically projectPath).
 *
 * Why this exists: AiCodeSession previously held the runtime tracker in
 * `useState`, so every assistant delta produced a `setRuntimeTracker` call
 * that re-rendered the entire AiCodeSession subtree (FloatingPromptInput,
 * MessageList, status bar, etc.). On long Claude streams this turned into
 * dozens of unnecessary parent re-renders per second, and the input box felt
 * laggy because each keystroke landed in the same React commit window as the
 * runtime updates.
 *
 * The store moves that high-frequency state out of the component tree. Only
 * components that explicitly subscribe with `useRuntimeTracker(key)` repaint
 * when the tracker changes, while parents read a stable reference and stay
 * still.
 *
 * The store also owns the rAF coalescing previously implemented inline in
 * `useSessionEvents`: callers push messages with `enqueue(key, message)` and
 * the store flushes the batch on the next animation frame.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { ClaudeStreamMessage, SessionRuntimeTracker } from '../types';
import { createInitialRuntimeTracker, reduceRuntimeTracker } from '../utils/runtimeState';

type Listener = () => void;

interface SessionEntry {
  tracker: SessionRuntimeTracker;
  listeners: Set<Listener>;
  pending: ClaudeStreamMessage[];
  rafHandle: number | null;
}

const emptyTracker: SessionRuntimeTracker = createInitialRuntimeTracker();
const sessions = new Map<string, SessionEntry>();

function ensureEntry(key: string): SessionEntry {
  let entry = sessions.get(key);
  if (!entry) {
    entry = {
      tracker: createInitialRuntimeTracker(),
      listeners: new Set(),
      pending: [],
      rafHandle: null,
    };
    sessions.set(key, entry);
  }
  return entry;
}

function notify(entry: SessionEntry): void {
  for (const listener of entry.listeners) {
    listener();
  }
}

function applyPending(entry: SessionEntry): void {
  if (entry.pending.length === 0) return;
  const messages = entry.pending;
  entry.pending = [];
  const now = Date.now();
  let next = entry.tracker;
  for (const message of messages) {
    next = reduceRuntimeTracker(next, message as any, now);
  }
  if (next !== entry.tracker) {
    entry.tracker = next;
    notify(entry);
  }
}

function scheduleFlush(entry: SessionEntry): void {
  if (entry.rafHandle !== null) return;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    // Server / test environment: flush synchronously so behaviour stays
    // observable in unit tests.
    applyPending(entry);
    return;
  }
  entry.rafHandle = window.requestAnimationFrame(() => {
    entry.rafHandle = null;
    applyPending(entry);
  });
}

/**
 * Queue a stream message for inclusion in the tracker on the next flush.
 * Multiple calls in the same animation frame are merged into one re-render.
 */
export function enqueueRuntimeMessage(key: string, message: ClaudeStreamMessage): void {
  if (!key) return;
  const entry = ensureEntry(key);
  entry.pending.push(message);
  scheduleFlush(entry);
}

/**
 * Flush any queued messages immediately. Used right before a session
 * boundary (clear / completion) to ensure the final tracker state is visible
 * before the next read.
 */
export function flushRuntimeMessages(key: string): void {
  if (!key) return;
  const entry = sessions.get(key);
  if (!entry) return;
  if (entry.rafHandle !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(entry.rafHandle);
    entry.rafHandle = null;
  }
  applyPending(entry);
}

/**
 * Reduce a single message and apply it synchronously. Useful when a
 * synthesized terminal message needs to land before the component reads.
 */
export function applyRuntimeMessage(key: string, message: ClaudeStreamMessage): void {
  if (!key) return;
  const entry = ensureEntry(key);
  // Make sure any queued deltas are folded in first to preserve order.
  applyPending(entry);
  const next = reduceRuntimeTracker(entry.tracker, message as any, Date.now());
  if (next !== entry.tracker) {
    entry.tracker = next;
    notify(entry);
  }
}

/**
 * Reset a session's tracker back to its initial state.
 */
export function resetRuntimeTracker(key: string): void {
  if (!key) return;
  const entry = sessions.get(key);
  if (!entry) return;
  if (entry.rafHandle !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(entry.rafHandle);
    entry.rafHandle = null;
  }
  entry.pending = [];
  if (entry.tracker !== emptyTracker) {
    entry.tracker = createInitialRuntimeTracker();
    notify(entry);
  }
}

/**
 * Direct read for paths that need the tracker without subscribing (e.g. an
 * imperative effect that runs once per send).
 */
export function getRuntimeTracker(key: string): SessionRuntimeTracker {
  if (!key) return emptyTracker;
  const entry = sessions.get(key);
  return entry ? entry.tracker : emptyTracker;
}

function subscribe(key: string, listener: Listener): () => void {
  const entry = ensureEntry(key);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/**
 * React hook: subscribe to a session's tracker and re-render only this
 * component (not its parents) when it changes.
 */
export function useRuntimeTracker(key: string): SessionRuntimeTracker {
  const sub = useCallback((listener: Listener) => subscribe(key, listener), [key]);
  const snap = useCallback(() => getRuntimeTracker(key), [key]);
  return useSyncExternalStore(sub, snap, () => emptyTracker);
}
