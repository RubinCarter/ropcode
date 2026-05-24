/**
 * Event Subscription Hooks
 *
 * Provides React hooks based on WebSocket RPC event system for subscribing to backend-pushed events.
 */

import { useEffect, useCallback, useRef } from 'react';
import { EventsOn, EventsOff } from '@/lib/rpc-events';

// ============ Event Type Definitions ============

export interface GitChangedEvent {
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  status: Record<string, string>;
}

export interface ProcessChangedEvent {
  pid: number;
  cwd: string;
  state: 'running' | 'stopped';
  exitCode?: number;
}

export interface SessionChangedEvent {
  id: string;
  cwd: string;
  state: 'active' | 'idle' | 'completed';
  provider: 'claude' | 'gemini' | 'codex';
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface WorktreeChangedEvent {
  path: string;
  worktrees: WorktreeInfo[];
}

// ============ Base Hook ============

/**
 * Generic event subscription hook
 *
 * Uses queueMicrotask to defer callback execution, avoiding state updates during React render cycle
 * that cause flushSync warnings (especially when components use @tanstack/react-virtual)
 */
export function useEventSubscription<T>(
  eventName: string,
  handler: (event: T) => void,
  enabled: boolean = true
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const wrappedHandler = (event: T) => {
      // Use queueMicrotask to defer to next microtask queue
      // Avoid triggering state update in current render cycle
      queueMicrotask(() => {
        handlerRef.current(event);
      });
    };

    EventsOn(eventName, wrappedHandler);

    return () => {
      EventsOff(eventName);
    };
  }, [eventName, enabled]);
}

// ============ Git Events ============

/**
 * Subscribe to Git change events
 * @param path Workspace path to listen for, listens to all if undefined
 * @param callback Change callback
 */
export function useGitChanged(
  path: string | undefined,
  callback: (event: GitChangedEvent) => void
): void {
  const stableCallback = useCallback(
    (event: GitChangedEvent) => {
      if (!path || event.path === path) {
        callback(event);
      }
    },
    [path, callback]
  );

  useEventSubscription('git:changed', stableCallback, true);
}

// ============ Process Events ============

/**
 * Subscribe to process state change events
 * @param cwd Working directory to listen for, listens to all if undefined
 * @param callback Change callback
 */
export function useProcessChanged(
  cwd: string | undefined,
  callback: (event: ProcessChangedEvent) => void
): void {
  const stableCallback = useCallback(
    (event: ProcessChangedEvent) => {
      if (!cwd || event.cwd === cwd) {
        callback(event);
      }
    },
    [cwd, callback]
  );

  useEventSubscription('process:changed', stableCallback, true);
}

// ============ Session Events ============

/**
 * Subscribe to AI session state change events
 * @param cwd Working directory to listen for, listens to all if undefined
 * @param callback Change callback
 */
export function useSessionChanged(
  cwd: string | undefined,
  callback: (event: SessionChangedEvent) => void
): void {
  const stableCallback = useCallback(
    (event: SessionChangedEvent) => {
      if (!cwd || event.cwd === cwd) {
        callback(event);
      }
    },
    [cwd, callback]
  );

  useEventSubscription('session:changed', stableCallback, true);
}

// ============ Worktree Events ============

/**
 * Subscribe to Worktree change events
 * @param path Repository path to listen for, listens to all if undefined
 * @param callback Change callback
 */
export function useWorktreeChanged(
  path: string | undefined,
  callback: (event: WorktreeChangedEvent) => void
): void {
  const stableCallback = useCallback(
    (event: WorktreeChangedEvent) => {
      if (!path || event.path === path) {
        callback(event);
      }
    },
    [path, callback]
  );

  useEventSubscription('worktree:changed', stableCallback, true);
}
