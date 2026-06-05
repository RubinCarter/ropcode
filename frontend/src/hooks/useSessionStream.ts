import { useEffect } from 'react';
import { getInitialWebSocketConfig } from '@/lib/ws-config';
import { connectSessionStream, type SessionStreamConnection } from '@/lib/ws/sessionStreamClient';
import { setSessionRuntimeConnected } from '@/stores/sessionRuntimeStore';

export interface UseSessionStreamOptions {
  enabled?: boolean;
  port?: number | string;
  authKey?: string;
  reloadOnRepeatedFailure?: boolean;
  reconnectDelayMs?: number;
}

export function useSessionStream(streamId: string | null | undefined, options: UseSessionStreamOptions = {}): void {
  const enabled = options.enabled ?? true;
  const configured = typeof window !== 'undefined'
    ? getInitialWebSocketConfig(window)
    : { port: undefined, authKey: undefined };
  const port = options.port ?? configured.port;
  const authKey = options.authKey ?? configured.authKey ?? undefined;

  useEffect(() => {
    if (!enabled || !streamId || !port) {
      return;
    }

    let connection: SessionStreamConnection | undefined;
    let reconnectTimer: number | undefined;
    let stopped = false;
    const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    setSessionRuntimeConnected(streamId, false);

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
    };

    const connect = () => {
      if (stopped) return;
      connection = connectSessionStream(port, authKey, streamId, {
        reloadOnRepeatedFailure: options.reloadOnRepeatedFailure,
        onFrame: () => setSessionRuntimeConnected(streamId, true),
        onDisconnect: () => {
          setSessionRuntimeConnected(streamId, false);
          scheduleReconnect();
        },
        onError: () => setSessionRuntimeConnected(streamId, false),
      });
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      connection?.close();
      setSessionRuntimeConnected(streamId, false);
    };
  }, [authKey, enabled, options.reconnectDelayMs, options.reloadOnRepeatedFailure, port, streamId]);
}
