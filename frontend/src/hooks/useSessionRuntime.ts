import { useCallback, useSyncExternalStore } from 'react';
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
  const subscribe = useCallback(
    (listener: () => void) => (streamId ? subscribeSessionRuntime(streamId, listener) : () => undefined),
    [streamId],
  );
  const getSnapshot = useCallback(
    () => (streamId ? getSessionRuntime(streamId) : EMPTY_RUNTIME),
    [streamId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_RUNTIME);
}
