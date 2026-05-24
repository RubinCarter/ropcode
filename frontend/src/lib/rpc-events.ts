/**
 * RPC event system
 *
 * Receives backend events via WebSocket.
 */

import { wsClient } from './ws-rpc-client';

export interface UnlistenFn {
  (): void;
}

/**
 * Listen for events
 */
export function EventsOn(eventName: string, handler: (data: any) => void): UnlistenFn {
  return wsClient.on(eventName, handler);
}

/**
 * Remove event listener
 */
export function EventsOff(eventName: string, handler?: (data: any) => void): void {
  wsClient.off(eventName, handler);
}

/**
 * Listen for events once
 */
export function EventsOnce(eventName: string, handler: (data: any) => void): UnlistenFn {
  const unlisten = wsClient.on(eventName, (data) => {
    unlisten();
    handler(data);
  });
  return unlisten;
}

/**
 * Send events (frontend to frontend, not routed through backend)
 */
export function EventsEmit(eventName: string, ...data: any[]): void {
  const event = new CustomEvent(eventName, { detail: data.length === 1 ? data[0] : data });
  window.dispatchEvent(event);
}

/**
 * Tauri-compatible listen function
 */
export async function listen<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOn(event, handler));
}

/**
 * Tauri-compatible once function
 */
export async function once<T = any>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return Promise.resolve(EventsOnce(event, handler));
}

/**
 * Tauri-compatible emit function
 */
export function emit(event: string, payload?: any): void {
  EventsEmit(event, payload);
}

/**
 * Remove all listeners for a specific event
 */
export function unlisten(event: string): void {
  EventsOff(event);
}
