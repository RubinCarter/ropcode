/**
 * Page Visibility Polling Hook
 *
 * 提供基于页面可见性的轮询机制。只在页面激活时进行轮询，页面隐藏时自动停止。
 */

import { useEffect, useRef, useCallback } from 'react';

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

/**
 * 基于页面可见性的轮询 Hook
 *
 * @param pollFn 轮询执行的异步函数
 * @param options 轮询配置选项
 *
 * @example
 * ```tsx
 * // 基本用法
 * usePageVisibilityPolling(async () => {
 *   await fetchGitStatus();
 * }, { interval: 3000 });
 *
 * // 带条件控制的轮询
 * usePageVisibilityPolling(async () => {
 *   const result = await checkStatus();
 *   return result.needsMorePolling;
 * }, { interval: 2000, shouldContinue: (r) => r.needsMorePolling });
 * ```
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPageVisibleRef = useRef(!document.hidden);
  const pollFnRef = useRef(pollFn);
  pollFnRef.current = pollFn;

  // 执行轮询函数
  const executePoll = useCallback(async () => {
    if (!enabled || !isPageVisibleRef.current) {
      return;
    }

    try {
      const result = await pollFnRef.current();

      // 检查是否需要继续轮询
      if (shouldContinue && !shouldContinue(result)) {
        // 条件不满足，停止轮询
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } catch (error) {
      // 静默处理错误，避免轮询中断
      console.error('[usePageVisibilityPolling] Polling error:', error);
    }
  }, [enabled, shouldContinue]);

  // 设置轮询定时器
  const startPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (immediate) {
      executePoll();
    }

    timerRef.current = setInterval(() => {
      executePoll();
    }, interval);
  }, [interval, immediate, executePoll]);

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 处理页面可见性变化
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      isPageVisibleRef.current = isVisible;

      if (isVisible && enabled) {
        // 页面变为可见，重新启动轮询
        startPolling();
      } else {
        // 页面变为隐藏，停止轮询
        stopPolling();
      }
    };

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 初始化：如果页面初始可见且启用，启动轮询
    if (!document.hidden && enabled) {
      startPolling();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [enabled, startPolling, stopPolling]);

  // 当 enabled 变化时，重新设置轮询
  useEffect(() => {
    if (!enabled) {
      stopPolling();
    } else if (!document.hidden) {
      startPolling();
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
