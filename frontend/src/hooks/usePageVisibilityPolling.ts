/**
 * Page Visibility Polling Hook
 *
 * Provides page-visibility-based polling. Only polls when page is active, auto-stops when hidden.
 * Uses random jitter on wake to stagger first polls across hooks, avoiding thundering herd.
 */

import { useEffect, useRef, useCallback } from 'react';
import { wsClient } from '@/lib/ws-rpc-client';

export interface PollingOptions {
  /** Polling interval (ms), default 3000ms */
  interval?: number;
  /** Whether to enable polling, default true */
  enabled?: boolean;
  /** Whether to execute once immediately when page visible, default true */
  immediate?: boolean;
  /** Poll function return value, used to determine if polling should continue */
  shouldContinue?: (result: unknown) => boolean;
}

// Per-instance jitter seed: each hook instance gets a stable random offset
// so that on wake all hooks spread their first poll over a window.
let jitterCounter = 0;

/**
 * Page-visibility-based polling hook
 */
export function usePageVisibilityPolling<T>(
  pollFn: () => Promise<T> | T,
  options: PollingOptions = {}
): void {
  const {
    interval = 3000,
    enabled = true,
    immediate = true,
    shouldContinue,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPageVisibleRef = useRef(!document.hidden);
  const pollFnRef = useRef(pollFn);
  const hiddenAtRef = useRef<number>(document.hidden ? Date.now() : 0);
  const jitterSeedRef = useRef(jitterCounter++);
  pollFnRef.current = pollFn;

  const executePoll = useCallback(async () => {
    if (!enabled || !isPageVisibleRef.current) return;
    if (!wsClient.isConnected()) return;

    try {
      const result = await pollFnRef.current();

      if (shouldContinue && !shouldContinue(result)) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('[usePageVisibilityPolling] Polling error:', error);
    }
  }, [enabled, shouldContinue]);

  const startPolling = useCallback((stagger: boolean = false) => {
    if (timerRef.current) { clearTimeout(timerRef.current as any); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    const beginInterval = () => {
      intervalRef.current = setInterval(() => { executePoll(); }, interval);
    };

    if (immediate) {
      if (stagger) {
        // Spread first poll over 0–800ms window to avoid thundering herd on wake
        const delay = (jitterSeedRef.current % 8) * 100 + Math.random() * 100;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          executePoll();
          beginInterval();
        }, delay);
      } else {
        executePoll();
        beginInterval();
      }
    } else {
      beginInterval();
    }
  }, [interval, immediate, executePoll]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current as any); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      isPageVisibleRef.current = isVisible;

      if (isVisible && enabled) {
        const hiddenDuration = hiddenAtRef.current > 0 ? Date.now() - hiddenAtRef.current : 0;
        // Stagger if hidden for >2s (sleep/lock), not for quick tab switches
        startPolling(hiddenDuration > 2000);
      } else {
        hiddenAtRef.current = Date.now();
        stopPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (!document.hidden && enabled) {
      startPolling(false);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [enabled, startPolling, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
    } else if (!document.hidden) {
      startPolling(false);
    }
  }, [enabled, startPolling, stopPolling]);
}

/**
 * Utility function to check if page is visible
 */
export function isPageVisible(): boolean {
  return !document.hidden;
}

/**
 * Page visibility change listener hook
 *
 * @param callback Callback when page visibility changes
 * @param immediate Whether to call callback once immediately on init
 *
 * @example
 * ```tsx
 * usePageVisibility((isVisible) => {
 *   console.log('Page is now:', isVisible ? 'visible' : 'hidden');
 * }, true);
 * ```
 */
export function usePageVisibility(
  callback: (isVisible: boolean) => void,
  immediate: boolean = true
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handleVisibilityChange = () => {
      callbackRef.current(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Call once immediately
    if (immediate) {
      callbackRef.current(!document.hidden);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [immediate]);
}
