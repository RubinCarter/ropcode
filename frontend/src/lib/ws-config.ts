export interface WebSocketConfigSource {
  location: {
    port?: string;
    search?: string;
  };
  __ROPCODE_WS_PORT__?: number | string;
  __ROPCODE_AUTH_KEY__?: string;
  electronAPI?: {
    wsPort?: number;
    authKey?: string;
  };
}

export function getInitialWebSocketConfig(source: WebSocketConfigSource): { port?: number | string | null; authKey?: string | null } {
  const urlParams = new URLSearchParams(source.location.search || '');

  const port = source.electronAPI?.wsPort
    || source.__ROPCODE_WS_PORT__
    || parseInt(source.location.port || '', 10)
    || urlParams.get('wsPort');

  const authKey = source.electronAPI?.authKey
    || source.__ROPCODE_AUTH_KEY__
    || urlParams.get('authKey');

  return { port, authKey };
}
