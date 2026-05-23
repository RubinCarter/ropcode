import { normalizeSessionFrame } from '@/lib/session-frame/normalize';
import type { SessionFrame } from '@/lib/session-frame/types';
import { appendSessionFrame } from '@/stores/sessionFrameStore';
import { buildWebSocketUrl, encodePathPart } from './url';
import { streamReloadCircuitBreaker } from './reloadCircuitBreaker';

export interface SessionStreamConnection {
  close(): void;
  isConnected(): boolean;
}

export interface SessionStreamClientOptions {
  onFrame?: (frame: SessionFrame) => void;
  onDisconnect?: (event?: CloseEvent | Event) => void;
  onError?: (event: Event) => void;
  reloadOnRepeatedFailure?: boolean;
  WebSocketCtor?: typeof WebSocket;
}

export function getSessionStreamWebSocketUrl(
  port: number | string,
  authKey: string | undefined,
  streamId: string,
  location: Location = window.location,
): string {
  return buildWebSocketUrl(port, `/ws/stream/session/${encodePathPart(streamId)}`, authKey, location);
}

export function connectSessionStream(
  port: number | string,
  authKey: string | undefined,
  streamId: string,
  options: SessionStreamClientOptions = {},
): SessionStreamConnection {
  const WebSocketCtor = options.WebSocketCtor ?? WebSocket;
  const ws = new WebSocketCtor(getSessionStreamWebSocketUrl(port, authKey, streamId));
  let manuallyClosed = false;

  ws.onopen = () => {
    streamReloadCircuitBreaker.recordSuccess();
  };

  ws.onmessage = (event) => {
    const frame = normalizeSessionFrame(JSON.parse(event.data));
    appendSessionFrame(frame);
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
