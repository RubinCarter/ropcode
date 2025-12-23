/**
 * Event Subscription Hooks
 *
 * 提供基于 WebSocket RPC 事件系统的 React hooks，用于订阅后端推送的事件。
 */

import { useEffect, useCallback, useRef } from 'react';
import { EventsOn, EventsOff } from '@/lib/rpc-events';

// ============ 事件类型定义 ============

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

// ============ 基础 Hook ============

/**
 * 通用事件订阅 hook
 *
 * 使用 queueMicrotask 延迟回调执行，避免在 React 渲染周期内触发状态更新
 * 导致的 flushSync 警告（特别是当组件使用 @tanstack/react-virtual 时）
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
      // 使用 queueMicrotask 延迟到下一个微任务队列
      // 避免在当前渲染周期内触发状态更新
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

// ============ Git 事件 ============

/**
 * 订阅 Git 变化事件
 * @param path 要监听的工作区路径，如果为 undefined 则监听所有
 * @param callback 变化回调
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

// ============ 进程事件 ============

/**
 * 订阅进程状态变化事件
 * @param cwd 要监听的工作目录，如果为 undefined 则监听所有
 * @param callback 变化回调
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

// ============ 会话事件 ============

/**
 * 订阅 AI 会话状态变化事件
 * @param cwd 要监听的工作目录，如果为 undefined 则监听所有
 * @param callback 变化回调
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

// ============ Worktree 事件 ============

/**
 * 订阅 Worktree 变化事件
 * @param path 要监听的仓库路径，如果为 undefined 则监听所有
 * @param callback 变化回调
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
