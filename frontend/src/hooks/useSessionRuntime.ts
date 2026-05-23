import { useSyncExternalStore } from 'react';
import {
  getSessionRuntime,
  subscribeSessionRuntime,
  type SessionRuntimeState,
} from '@/stores/sessionRuntimeStore';

const EMPTY_RUNTIME: SessionRuntimeState = {
  streamId: '',
  connected: false,
  lastSeq: 0,
};

export function useSessionRuntime(streamId: string | null | undefined): SessionRuntimeState {
  return useSyncExternalStore(
    (listener) => (streamId ? subscribeSessionRuntime(streamId, listener) : () => undefined),
    () => (streamId ? getSessionRuntime(streamId) : EMPTY_RUNTIME),
    () => EMPTY_RUNTIME,
  );
}
