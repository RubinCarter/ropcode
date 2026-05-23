import { useEffect } from 'react';
import { getInitialWebSocketConfig } from '@/lib/ws-config';
import { connectSessionStream, type SessionStreamConnection } from '@/lib/ws/sessionStreamClient';
import { setSessionRuntimeConnected } from '@/stores/sessionRuntimeStore';

export interface UseSessionStreamOptions {
  enabled?: boolean;
  port?: number | string;
  authKey?: string;
  reloadOnRepeatedFailure?: boolean;
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
    setSessionRuntimeConnected(streamId, false);

    connection = connectSessionStream(port, authKey, streamId, {
      reloadOnRepeatedFailure: options.reloadOnRepeatedFailure,
      onFrame: () => setSessionRuntimeConnected(streamId, true),
      onDisconnect: () => setSessionRuntimeConnected(streamId, false),
      onError: () => setSessionRuntimeConnected(streamId, false),
    });

    return () => {
      connection?.close();
      setSessionRuntimeConnected(streamId, false);
    };
  }, [authKey, enabled, options.reloadOnRepeatedFailure, port, streamId]);
}
