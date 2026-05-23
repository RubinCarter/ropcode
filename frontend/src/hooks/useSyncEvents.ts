import { useEffect, useSyncExternalStore } from 'react';
import { getInitialWebSocketConfig } from '@/lib/ws-config';
import { connectSyncStream, type SyncConnection } from '@/lib/ws/syncClient';
import { getSyncEvents, subscribeSyncEvents, type SyncEvent } from '@/stores/syncStore';

const EMPTY_EVENTS: SyncEvent[] = [];

export interface UseSyncEventsOptions {
  enabled?: boolean;
  port?: number | string;
  authKey?: string;
  reloadOnRepeatedFailure?: boolean;
}

export function useSyncEvents(options: UseSyncEventsOptions = {}): SyncEvent[] {
  const enabled = options.enabled ?? true;
  const configured = typeof window !== 'undefined'
    ? getInitialWebSocketConfig(window)
    : { port: undefined, authKey: undefined };
  const port = options.port ?? configured.port;
  const authKey = options.authKey ?? configured.authKey ?? undefined;

  useEffect(() => {
    if (!enabled || !port) {
      return;
    }

    let connection: SyncConnection | undefined;
    connection = connectSyncStream(port, authKey, {
      reloadOnRepeatedFailure: options.reloadOnRepeatedFailure,
    });

    return () => connection?.close();
  }, [authKey, enabled, options.reloadOnRepeatedFailure, port]);

  return useSyncExternalStore(
    subscribeSyncEvents,
    getSyncEvents,
    () => EMPTY_EVENTS,
  );
}
