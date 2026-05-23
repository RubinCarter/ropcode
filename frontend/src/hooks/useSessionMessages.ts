import { useSyncExternalStore } from 'react';
import {
  getSessionMessages,
  subscribeSessionFrames,
  type SessionDisplayMessage,
} from '@/stores/sessionFrameStore';

const EMPTY_MESSAGES: SessionDisplayMessage[] = [];

export function useSessionMessages(streamId: string | null | undefined): SessionDisplayMessage[] {
  return useSyncExternalStore(
    (listener) => (streamId ? subscribeSessionFrames(streamId, listener) : () => undefined),
    () => (streamId ? getSessionMessages(streamId) : EMPTY_MESSAGES),
    () => EMPTY_MESSAGES,
  );
}
