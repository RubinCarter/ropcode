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

function createFakeBrowser() {
  let visibilityHandler: (() => void) | null = null;
  let hidden = false;
  const wsInstances: FakeWebSocket[] = [];
  const wsUrls: string[] = [];
  const sentMessages: string[] = [];

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
      wsInstances.push(this);
      wsUrls.push(url);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(payload: string) {
      sentMessages.push(payload);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  return {
    FakeWebSocket,
    wsInstances,
    wsUrls,
    sentMessages,
    setHidden(value: boolean) {
      hidden = value;
      visibilityHandler?.();
    },
    window: {
      location: {
        hostname: 'localhost',
        origin: 'http://localhost:5173',
      },
      __ROPCODE_AUTH_KEY__: 'old-key',
    },
    document: {
      addEventListener(type: string, cb: () => void) {
        if (type === 'visibilitychange') visibilityHandler = cb;
      },
      get hidden() {
        return hidden;
      },
      get visibilityState() {
        return hidden ? 'hidden' : 'visible';
      },
    },
  };
}

test('uses longer timeout for project chat provider operations', async () => {
  const { getRpcTimeout } = await loadModule();

  assert.equal(getRpcTimeout('CreateProjectChat') > 30_000, true);
  assert.equal(getRpcTimeout('SendProjectChatMessage') > 30_000, true);
  assert.equal(getRpcTimeout('SwitchProjectChatProvider') > 30_000, true);
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

test('prefers explicit websocket port over page asset port', async () => {
  const { getInitialWebSocketConfig } = await loadWsConfigModule();

  const config = getInitialWebSocketConfig({
    location: { search: '?wsPort=5196&authKey=runtime-key', port: '34115' },
  } as any);

  assert.equal(config.port, '5196');
  assert.equal(config.authKey, 'runtime-key');
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

test('does not reconnect on long visibility restore when websocket still reports open', async () => {
  const { wsClient } = await loadModule();

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  const fake = createFakeBrowser();

  try {
    (globalThis as any).window = fake.window;
    (globalThis as any).document = fake.document;
    (globalThis as any).WebSocket = fake.FakeWebSocket as any;
    (globalThis as any).fetch = async () => ({
      async text() {
        return '<html><head><script>window.__ROPCODE_AUTH_KEY__="old-key";</script></head></html>';
      },
    } as Response);

    await wsClient.connect(5173, 'old-key');
    assert.equal(fake.wsUrls.length, 1);
    assert.equal(wsClient.isConnected(), true);

    fake.setHidden(true);
    await delay(2100);
    fake.setHidden(false);
    await delay(0);

    assert.equal(fake.wsUrls.length, 1, 'expected open websocket to be left intact after idle restore');
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).fetch = originalFetch;
    resetClient(wsClient as any);
  }
});

test('reconnects on visibility restore when websocket is no longer open', async () => {
  const { wsClient } = await loadModule();

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  const fake = createFakeBrowser();

  try {
    (globalThis as any).window = fake.window;
    (globalThis as any).document = fake.document;
    (globalThis as any).WebSocket = fake.FakeWebSocket as any;
    (globalThis as any).fetch = async () => ({
      async text() {
        return '<html><head><script>window.__ROPCODE_AUTH_KEY__="old-key";</script></head></html>';
      },
    } as Response);

    await wsClient.connect(5173, 'old-key');
    const socket = fake.wsInstances[0];
    socket.readyState = fake.FakeWebSocket.CLOSED;

    fake.setHidden(true);
    await delay(2100);
    fake.setHidden(false);
    await delay(0);

    assert.equal(fake.wsUrls.length, 2, 'expected closed websocket to reconnect after visibility restore');
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).fetch = originalFetch;
    resetClient(wsClient as any);
  }
});

test('forces reconnect after an rpc timeout on a stale open websocket without replaying the call', async () => {
  const { wsClient } = await loadModule();

  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const fake = createFakeBrowser();
  const timers: Array<{ fn: () => void; ms: number }> = [];

  try {
    (globalThis as any).window = fake.window;
    (globalThis as any).document = fake.document;
    (globalThis as any).WebSocket = fake.FakeWebSocket as any;
    (globalThis as any).fetch = async () => ({
      async text() {
        return '<html><head><script>window.__ROPCODE_AUTH_KEY__="old-key";</script></head></html>';
      },
    } as Response);

    await wsClient.connect(5173, 'old-key');

    (globalThis as any).setTimeout = ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length as any;
    }) as typeof setTimeout;
    (globalThis as any).clearTimeout = (() => {}) as typeof clearTimeout;

    let callError = '';
    const callPromise = wsClient.call('ListProjects').catch((err) => {
      callError = err.message;
    });

    assert.equal(fake.sentMessages.length, 1);
    assert.equal(timers[0]?.ms, 30000);
    timers[0].fn();
    await callPromise;

    assert.equal(callError, 'RPC call ListProjects timed out');
    assert.equal(fake.wsUrls.length, 2, 'expected rpc timeout to force a fresh websocket');
    assert.equal(fake.sentMessages.length, 1, 'timed-out RPC must not be replayed automatically');
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
