// frontend/src/lib/ws-rpc-client.ts

export interface RPCRequest {
  id: string;
  method: string;
  params: any[];
}

export interface RPCResponse {
  id: string;
  result?: any;
  error?: string;
}

export interface WSEvent {
  type: string;
  payload: any;
}

export interface WSMessage {
  kind: 'rpc_request' | 'rpc_response' | 'event';
  request?: RPCRequest;
  response?: RPCResponse;
  event?: WSEvent;
}

type EventHandler = (payload: any) => void;

/**
 * Generate a UUID that works in non-secure contexts (HTTP).
 * crypto.randomUUID() requires a secure context (HTTPS or localhost),
 * so we fall back to crypto.getRandomValues() which works everywhere.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: build a v4-style UUID from getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class WSRpcClient {
  private ws: WebSocket | null = null;
  private pending: Map<string, { resolve: (value: any) => void; reject: (reason: any) => void }> = new Map();
  private eventListeners: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private wsUrl: string = '';
  private authKey: string = '';
  private connectPromise: Promise<void> | null = null;
  private connectResolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private onConnectCallbacks: Set<() => void> = new Set();

  /**
   * 初始化连接
   */
  async connect(port: number, authKey?: string): Promise<void> {
    const host = window.location.hostname || '127.0.0.1';
    const url = new URL(`ws://${host}:${port}/ws`);
    if (authKey) {
      url.searchParams.set('authKey', authKey);
    }
    this.wsUrl = url.toString();
    this.authKey = authKey || '';
    this.connectPromise = this.doConnect();
    return this.connectPromise;
  }

  /**
   * 等待连接就绪
   * 如果已连接，立即返回；如果正在连接，等待连接完成
   */
  async waitForConnection(timeout: number = 10000): Promise<void> {
    // 如果已经连接，直接返回
    if (this.isConnected()) {
      return;
    }

    // Always use connectResolvers approach: this handles both "connecting" and
    // "reconnecting after failure" cases. The previous approach of awaiting
    // connectPromise would fail immediately if the initial connection had
    // already rejected.
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.connectResolvers.findIndex(r => r.resolve === resolve);
        if (index !== -1) {
          this.connectResolvers.splice(index, 1);
        }
        reject(new Error('Connection timeout'));
      }, timeout);

      this.connectResolvers.push({
        resolve: () => {
          clearTimeout(timeoutId);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timeoutId);
          reject(err);
        },
      });
    });
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[WSRpc] Connected');
          this.reconnectAttempts = 0;
          // 通知所有等待连接的 resolvers
          this.connectResolvers.forEach(r => r.resolve());
          this.connectResolvers = [];
          // Fire onConnect callbacks (e.g. to reload data after reconnect)
          this.onConnectCallbacks.forEach(cb => { try { cb(); } catch (e) { console.error('[WSRpc] onConnect callback error:', e); } });
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          console.log('[WSRpc] Disconnected');
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[WSRpc] Error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Refresh authKey by fetching the current page HTML from Go server.
   * Go injects __ROPCODE_AUTH_KEY__ into every HTML response, so after
   * a Go restart the new key can be obtained this way.
   */
  private async refreshAuthKey(): Promise<void> {
    try {
      const resp = await fetch(window.location.origin, { cache: 'no-store' });
      const html = await resp.text();
      const match = html.match(/__ROPCODE_AUTH_KEY__="([^"]+)"/);
      if (match && match[1] && match[1] !== this.authKey) {
        console.log('[WSRpc] AuthKey refreshed');
        this.authKey = match[1];
        // Rebuild wsUrl with new authKey
        const url = new URL(this.wsUrl);
        url.searchParams.set('authKey', this.authKey);
        this.wsUrl = url.toString();
        // Also update global for other consumers
        (window as any).__ROPCODE_AUTH_KEY__ = this.authKey;
      }
    } catch (err) {
      console.warn('[WSRpc] Failed to refresh authKey:', err);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WSRpc] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[WSRpc] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      // On auth failures, try to get the latest authKey from Go server
      await this.refreshAuthKey();
      this.doConnect().catch(console.error);
    }, delay);
  }

  private handleMessage(data: string) {
    try {
      const msg: WSMessage = JSON.parse(data);

      if (msg.kind === 'rpc_response' && msg.response) {
        const { id, result, error } = msg.response;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(result);
          }
        }
      } else if (msg.kind === 'event' && msg.event) {
        const { type, payload } = msg.event;
        const listeners = this.eventListeners.get(type);
        if (listeners) {
          listeners.forEach((handler) => {
            try {
              handler(payload);
            } catch (e) {
              console.error(`[WSRpc] Event handler error for ${type}:`, e);
            }
          });
        }
      }
    } catch (e) {
      console.error('[WSRpc] Failed to parse message:', e);
    }
  }

  /**
   * 发送 RPC 调用
   */
  async call<T = any>(method: string, ...params: any[]): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = generateId();
    const request: WSMessage = {
      kind: 'rpc_request',
      request: { id, method, params },
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      // 设置超时（默认 30 秒）
      const timeout = this.getTimeout(method);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC call ${method} timed out`));
        }
      }, timeout);

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * 根据方法名返回超时时间（毫秒）
   */
  private getTimeout(method: string): number {
    const longTimeoutMethods = [
      'LoadProviderSessionHistory',
      'LoadSessionHistory',
      'LoadAgentSessionHistory',
    ];
    if (longTimeoutMethods.includes(method)) {
      return 120000; // 2 minutes for history loading
    }
    return 30000;
  }

  /**
   * 监听事件
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(handler);

    // 返回取消监听函数
    return () => {
      this.eventListeners.get(eventType)?.delete(handler);
    };
  }

  /**
   * 移除事件监听
   */
  off(eventType: string, handler?: EventHandler) {
    if (handler) {
      this.eventListeners.get(eventType)?.delete(handler);
    } else {
      this.eventListeners.delete(eventType);
    }
  }

  /**
   * 关闭连接
   */
  close() {
    this.maxReconnectAttempts = 0; // 防止重连
    this.ws?.close();
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Register a callback that fires whenever a WebSocket connection is established
   * (including reconnections). Returns an unsubscribe function.
   */
  onConnect(cb: () => void): () => void {
    this.onConnectCallbacks.add(cb);
    return () => { this.onConnectCallbacks.delete(cb); };
  }
}

// 单例导出
export const wsClient = new WSRpcClient();
