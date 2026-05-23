import { buildWebSocketUrl } from './url';

export function getRpcWebSocketUrl(
  port: number | string,
  authKey?: string,
  location: Location = window.location,
): string {
  return buildWebSocketUrl(port, '/ws/rpc', authKey, location);
}

export { wsClient } from '@/lib/ws-rpc-client';
