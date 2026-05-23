import { appendSyncEvent, type SyncEvent } from '@/stores/syncStore';
import { buildWebSocketUrl } from './url';
import { streamReloadCircuitBreaker } from './reloadCircuitBreaker';

export interface SyncConnection {
  close(): void;
  isConnected(): boolean;
}

export interface SyncClientOptions {
  onEvent?: (event: SyncEvent) => void;
  onDisconnect?: (event?: CloseEvent | Event) => void;
  onError?: (event: Event) => void;
  reloadOnRepeatedFailure?: boolean;
  WebSocketCtor?: typeof WebSocket;
}

export function getSyncWebSocketUrl(
  port: number | string,
  authKey?: string,
  location: Location = window.location,
): string {
  return buildWebSocketUrl(port, '/ws/sync', authKey, location);
}

export function connectSyncStream(
  port: number | string,
  authKey: string | undefined,
  options: SyncClientOptions = {},
): SyncConnection {
  const WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  const ws = new WebSocketCtor(getSyncWebSocketUrl(port, authKey));
  let manuallyClosed = false;

  ws.onopen = () => {
    streamReloadCircuitBreaker.recordSuccess();
  };

  ws.onmessage = (message) => {
    const event = JSON.parse(message.data) as SyncEvent;
    appendSyncEvent(event);
    options.onEvent?.(event);
  };

  ws.onerror = (event) => {
    options.onError?.(event);
  };

  ws.onclose = (event) => {
    if (!manuallyClosed && streamReloadCircuitBreaker.recordFailure() && options.reloadOnRepeatedFailure) {
      window.location.reload();
      return;
    }
    options.onDisconnect?.(event);
  };

  return {
    close() {
      manuallyClosed = true;
      ws.close();
    },
    isConnected() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}
