import { useCallback, useSyncExternalStore } from 'react';
import {
  getSessionMessages,
  subscribeSessionFrames,
  type SessionDisplayMessage,
} from '@/stores/sessionFrameStore';

const EMPTY_MESSAGES: SessionDisplayMessage[] = [];

export function useSessionMessages(streamId: string | null | undefined): SessionDisplayMessage[] {
  const subscribe = useCallback(
    (listener: () => void) => (streamId ? subscribeSessionFrames(streamId, listener) : () => undefined),
    [streamId],
  );
  const getSnapshot = useCallback(
    () => (streamId ? getSessionMessages(streamId) : EMPTY_MESSAGES),
    [streamId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MESSAGES);
}
