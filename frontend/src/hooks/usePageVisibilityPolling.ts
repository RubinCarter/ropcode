/**
 * Page Visibility Polling Hook
 *
 * 提供基于页面可见性的轮询机制。只在页面激活时进行轮询，页面隐藏时自动停止。
 * 休眠唤醒时通过随机 jitter 错开各 hook 的首次轮询，避免 thundering herd。
 */

import { useEffect, useRef, useCallback } from 'react';
import { wsClient } from '@/lib/ws-rpc-client';

export interface PollingOptions {
  /** 轮询间隔（毫秒），默认 3000ms */
  interval?: number;
  /** 是否启用轮询，默认 true */
  enabled?: boolean;
  /** 页面可见时是否立即执行一次，默认 true */
  immediate?: boolean;
  /** 轮询函数返回值，用于判断是否需要继续轮询 */
  shouldContinue?: (result: unknown) => boolean;
}

// Per-instance jitter seed: each hook instance gets a stable random offset
// so that on wake all hooks spread their first poll over a window.
let jitterCounter = 0;

/**
 * 基于页面可见性的轮询 Hook
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
 * 检查页面是否可见的工具函数
 */
export function isPageVisible(): boolean {
  return !document.hidden;
}

/**
 * 页面可见性变化监听 Hook
 *
 * @param callback 页面可见性变化时的回调
 * @param immediate 初始化时是否立即调用一次回调
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

    // 立即调用一次
    if (immediate) {
      callbackRef.current(!document.hidden);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [immediate]);
}
