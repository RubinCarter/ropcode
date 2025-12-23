// frontend/src/lib/wails-events-compat.ts
/**
 * Wails 事件系统兼容层
 *
 * 提供与 wailsjs/runtime/runtime 相同的事件 API，
 * 内部通过 WebSocket 接收后端事件。
 */

import { wsClient } from './ws-rpc-client';

export interface UnlistenFn {
  (): void;
}

/**
 * 监听��件
 */
export function EventsOn(eventName: string, handler: (data: any) => void): UnlistenFn {
  return wsClient.on(eventName, handler);
}

/**
 * 移除事件监听
 */
export function EventsOff(eventName: string, handler?: (data: any) => void): void {
  wsClient.off(eventName, handler);
}

/**
 * 监听事件一次
 */
export function EventsOnce(eventName: string, handler: (data: any) => void): UnlistenFn {
  const unlisten = wsClient.on(eventName, (data) => {
    unlisten();
    handler(data);
  });
  return unlisten;
}

/**
 * 发送事件（前端到前端，不经过后端）
 */
export function EventsEmit(eventName: string, ...data: any[]): void {
  const event = new CustomEvent(eventName, { detail: data.length === 1 ? data[0] : data });
  window.dispatchEvent(event);
}

/**
 * Tauri 兼容的 listen 函数
 */
export async function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOn(event, handler));
}

/**
 * Tauri 兼容的 once 函数
 */
export async function once<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOnce(event, handler));
}

/**
 * Tauri 兼容的 emit 函数
 */
export function emit(event: string, payload?: any): void {
  EventsEmit(event, payload);
}

/**
 * 解除指定事件的所有监听器
 */
export function unlisten(event: string): void {
  EventsOff(event);
}
