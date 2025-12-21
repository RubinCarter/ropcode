/**
 * Wails Events Adapter
 *
 * 提供 Tauri 兼容的事件系统层，将 Tauri 风格的事件监听映射到 Wails 事件系统。
 */

import { EventsOn, EventsOff, EventsOnce, EventsEmit } from '../../wailsjs/runtime/runtime';

/**
 * 解除监听函数的类型定义
 */
export interface UnlistenFn {
  (): void;
}

/**
 * Tauri 兼容的事件监听函数
 *
 * 监听指定的事件并在事件触发时调用回调函数。
 * 返回一个 Promise，解析为解除监听的函数。
 *
 * @param event - 要监听的事件名称
 * @param handler - 事件触发时的回调函数
 * @returns Promise<UnlistenFn> 解析为解除监听的函数
 *
 * @example
 * ```typescript
 * const unlisten = await listen('my-event', (payload) => {
 *   console.log('收到事件:', payload);
 * });
 *
 * // 稍后解除监听
 * unlisten();
 * ```
 */
export async function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  // Wails 的 EventsOn 直接注册监听器
  EventsOn(event, handler);

  // 返回解除监听的函数
  const unlisten = () => {
    EventsOff(event);
  };

  // Tauri 的 listen 返回 Promise，这里为了兼容也返回 Promise
  return Promise.resolve(unlisten);
}

/**
 * 监听事件一次
 *
 * 监听指定的事件，但只在第一次触发时调用回调函数，之后自动解除监听。
 *
 * @param event - 要监听的事件名称
 * @param handler - 事件触发时的回调函数
 * @returns Promise<UnlistenFn> 解析为解除监听的函数
 *
 * @example
 * ```typescript
 * await once('init-complete', (payload) => {
 *   console.log('初始化完成:', payload);
 * });
 * ```
 */
export async function once<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  // Wails 的 EventsOnce 只监听一次
  EventsOnce(event, handler);

  // 返回解除监听的函数（虽然只触发一次，但提供统一接口）
  const unlisten = () => {
    EventsOff(event);
  };

  return Promise.resolve(unlisten);
}

/**
 * 发送事件
 *
 * 向所有监听指定事件的处理器发送事件。
 *
 * @param event - 要发送的事件名称
 * @param payload - 事件负载数据（可选）
 *
 * @example
 * ```typescript
 * emit('user-action', { action: 'click', target: 'button' });
 * ```
 */
export function emit(event: string, payload?: any): void {
  if (payload !== undefined) {
    EventsEmit(event, payload);
  } else {
    EventsEmit(event);
  }
}

/**
 * 解除指定事件的所有监听器
 *
 * @param event - 要解除监听的事件名称
 *
 * @example
 * ```typescript
 * unlisten('my-event');
 * ```
 */
export function unlisten(event: string): void {
  EventsOff(event);
}

/**
 * 导出 Wails 原生事件函数供直接使用
 */
export {
  EventsOn,
  EventsOff,
  EventsOnce,
  EventsEmit
} from '../../wailsjs/runtime/runtime';
