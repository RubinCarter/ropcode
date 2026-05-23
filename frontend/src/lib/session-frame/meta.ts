import type { SessionFrame } from './types';

export function rawProviderField<T = unknown>(frame: SessionFrame, key: string): T | undefined {
  return frame.meta?.raw?.[key] as T | undefined;
}
