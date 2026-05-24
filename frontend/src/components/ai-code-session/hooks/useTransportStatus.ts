import { useEffect, useState } from 'react';
import { wsClient } from '@/lib/ws-rpc-client';

interface UseTransportStatusOptions {
  isLoading: boolean;
}

export interface UseTransportStatusReturn {
  transportConnected: boolean;
  lastTransportConnectAt: number | null;
}

export function useTransportStatus({ isLoading }: UseTransportStatusOptions): UseTransportStatusReturn {
  const [transportConnected, setTransportConnected] = useState(() => wsClient.isConnected());
  const [lastTransportConnectAt, setLastTransportConnectAt] = useState<number | null>(() => (
    wsClient.isConnected() ? Date.now() : null
  ));

  useEffect(() => {
    setTransportConnected(wsClient.isConnected());
    const unsub = wsClient.onConnect(() => {
      setTransportConnected(true);
      setLastTransportConnectAt(Date.now());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setTransportConnected(wsClient.isConnected());
    }
  }, [isLoading]);

  return {
    transportConnected,
    lastTransportConnectAt,
  };
}
