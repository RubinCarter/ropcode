import { appendBulkFrame, type BulkFrame } from '@/stores/bulkStore';
import { buildWebSocketUrl, encodePathPart } from './url';
import { streamReloadCircuitBreaker } from './reloadCircuitBreaker';

export interface BulkStreamConnection {
  close(): void;
  isConnected(): boolean;
}

export interface BulkStreamClientOptions {
  onFrame?: (frame: BulkFrame) => void;
  onDisconnect?: (event?: CloseEvent | Event) => void;
  onError?: (event: Event) => void;
  reloadOnRepeatedFailure?: boolean;
  WebSocketCtor?: typeof WebSocket;
}

export function getBulkStreamWebSocketUrl(
  port: number | string,
  authKey: string | undefined,
  source: string,
  id: string,
  location: Location = window.location,
): string {
  return buildWebSocketUrl(
    port,
    `/ws/stream/bulk/${encodePathPart(source)}/${encodePathPart(id)}`,
    authKey,
    location,
  );
}

export function connectBulkStream(
  port: number | string,
  authKey: string | undefined,
  source: string,
  id: string,
  options: BulkStreamClientOptions = {},
): BulkStreamConnection {
  const WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  const ws = new WebSocketCtor(getBulkStreamWebSocketUrl(port, authKey, source, id));
  let manuallyClosed = false;

  ws.onopen = () => {
    streamReloadCircuitBreaker.recordSuccess();
  };

  ws.onmessage = (event) => {
    const frame = JSON.parse(event.data) as BulkFrame;
    appendBulkFrame(frame);
    options.onFrame?.(frame);
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
