import { useEffect, useSyncExternalStore } from 'react';
import { getInitialWebSocketConfig } from '@/lib/ws-config';
import { connectBulkStream, type BulkStreamConnection } from '@/lib/ws/bulkStreamClient';
import { getBulkFrames, getBulkText, subscribeBulk, type BulkFrame } from '@/stores/bulkStore';

const EMPTY_FRAMES: BulkFrame[] = [];

export interface UseBulkStreamOptions {
  enabled?: boolean;
  port?: number | string;
  authKey?: string;
  reloadOnRepeatedFailure?: boolean;
}

export interface BulkStreamState {
  frames: BulkFrame[];
  text: string;
}

export function useBulkStream(source: string | null | undefined, id: string | null | undefined, options: UseBulkStreamOptions = {}): BulkStreamState {
  const enabled = options.enabled ?? true;
  const configured = typeof window !== 'undefined'
    ? getInitialWebSocketConfig(window)
    : { port: undefined, authKey: undefined };
  const port = options.port ?? configured.port;
  const authKey = options.authKey ?? configured.authKey ?? undefined;

  useEffect(() => {
    if (!enabled || !source || !id || !port) {
      return;
    }

    let connection: BulkStreamConnection | undefined;
    connection = connectBulkStream(port, authKey, source, id, {
      reloadOnRepeatedFailure: options.reloadOnRepeatedFailure,
    });

    return () => connection?.close();
  }, [authKey, enabled, id, options.reloadOnRepeatedFailure, port, source]);

  const frames = useSyncExternalStore(
    (listener) => (source && id ? subscribeBulk(source, id, listener) : () => undefined),
    () => (source && id ? getBulkFrames(source, id) : EMPTY_FRAMES),
    () => EMPTY_FRAMES,
  );

  const text = source && id ? getBulkText(source, id) : '';
  return { frames, text };
}
