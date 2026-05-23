import { getWebSocketHost } from '@/lib/ws-config';

export function buildWebSocketUrl(
  port: number | string,
  path: string,
  authKey?: string,
  location: Location = window.location,
): string {
  const host = getWebSocketHost(location);
  const url = new URL(`ws://${host}:${port}${path}`);
  if (authKey) {
    url.searchParams.set('authKey', authKey);
  }
  return url.toString();
}

export function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}
