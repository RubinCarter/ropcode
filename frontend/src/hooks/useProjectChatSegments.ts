import { useCallback, useSyncExternalStore } from 'react';
import {
  getProjectChatSegments,
  subscribeProjectChatSegments,
  type ProjectChatSegment,
} from '@/stores/projectChatSegmentStore';

const EMPTY_SEGMENTS: ProjectChatSegment[] = [];

export function useProjectChatSegments(chatId: string | null | undefined): ProjectChatSegment[] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeProjectChatSegments(chatId, listener),
    [chatId],
  );
  const getSnapshot = useCallback(
    () => getProjectChatSegments(chatId),
    [chatId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SEGMENTS);
}
