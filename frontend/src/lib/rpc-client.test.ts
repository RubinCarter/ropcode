import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

async function loadModule() {
  try {
    return await import('./ws-rpc-client');
  } catch (error) {
    assert.fail(`ws-rpc-client module not implemented: ${error}`);
  }
}

function resetClient(wsClient: any) {
  wsClient.close();
  wsClient.ws = null;
  wsClient.connectPromise = null;
  wsClient.connectResolvers = [];
  wsClient.reconnectAttempts = 0;
  wsClient.maxReconnectAttempts = Infinity;
  wsClient.reconnectTimer = null;
  wsClient.connecting = false;
  wsClient.wsUrl = '';
  wsClient.authKey = '';
  wsClient.pending.clear();
}

test('uses longer timeout for interactive Claude session startup', async () => {
  const { getRpcTimeout } = await loadModule();

  assert.equal(getRpcTimeout('StartInteractiveClaudeSession') > 30_000, true);
});

async function loadWsConfigModule() {
  try {
    return await import('./ws-config');
  } catch (error) {
    assert.fail(`ws-config module not implemented: ${error}`);
  }
}

test('prefers electron auth key over stale injected html auth key on initial connect', async () => {
  const { getInitialWebSocketConfig } = await loadWsConfigModule();

  const config = getInitialWebSocketConfig({
    location: { search: '', port: '5173' },
    __ROPCODE_WS_PORT__: 5173,
    __ROPCODE_AUTH_KEY__: 'stale-html-key',
    electronAPI: {
      wsPort: 5173,
      authKey: 'fresh-electron-key',
    },
  } as any);

  assert.equal(config.port, 5173);
  assert.equal(config.authKey, 'fresh-electron-key');
});

test('uses localhost for websocket host when page is served from wails.localhost', async () => {
  const { getWebSocketHost } = await loadWsConfigModule();

  assert.equal(getWebSocketHost({ hostname: 'wails.localhost' } as Location), '127.0.0.1');
});


test('refreshes auth key before reconnecting after auth failure', async () => {
  const { wsClient } = await loadModule();

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const timeoutQueue: Array<() => void> = [];
  const fetchCalls: string[] = [];
  const wsUrls: string[] = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    url: string;
    onopen: ((event?: any) => void) | null = null;
    onclose: ((event?: any) => void) | null = null;
    onerror: ((event?: any) => void) | null = null;
    onmessage: ((event?: any) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      wsUrls.push(url);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send() {}
    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  try {
    (globalThis as any).window = {
      location: {
        hostname: 'localhost',
        origin: 'http://localhost:5173',
      },
      __ROPCODE_AUTH_KEY__: 'old-key',
    };

    (globalThis as any).document = {
      addEventListener() {},
      visibilityState: 'visible',
    };

    (globalThis as any).WebSocket = FakeWebSocket as any;
    (globalThis as any).fetch = async (input: string | URL | Request) => {
      fetchCalls.push(String(input));
      return {
        async text() {
          return '<html><head><script>window.__ROPCODE_AUTH_KEY__="new-key";</script></head></html>';
        },
      } as Response;
    };

    (globalThis as any).setTimeout = ((fn: (...args: any[]) => void) => {
      timeoutQueue.push(() => fn());
      return timeoutQueue.length as any;
    }) as typeof setTimeout;
    (globalThis as any).clearTimeout = (() => {}) as typeof clearTimeout;

    await wsClient.connect(5173, 'old-key');

    const initialSocket = (wsClient as any).ws as InstanceType<typeof FakeWebSocket>;
    assert.ok(initialSocket, 'expected initial websocket instance');
    assert.match(initialSocket.url, /authKey=old-key/);

    initialSocket.onerror?.({ type: 'error' });
    initialSocket.onclose?.({ type: 'close' });

    assert.equal(timeoutQueue.length > 0, true, 'expected reconnect to be scheduled');
    timeoutQueue.shift()?.();
    await delay(0);

    assert.deepEqual(fetchCalls, ['http://localhost:5173']);
    assert.match(wsUrls.at(-1) ?? '', /authKey=new-key/);
    assert.equal((globalThis as any).window.__ROPCODE_AUTH_KEY__, 'new-key');
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).fetch = originalFetch;
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
    resetClient(wsClient as any);
  }
});
