import { useEffect, useRef } from 'react';
import { useBulkStream } from './useBulkStream';

export function useAgentBulkMessages<TMessage>(
  id: string | number | null | undefined,
  onMessage: (message: TMessage) => void,
  options: { enabled?: boolean; skipInitial?: boolean } = {},
): void {
  const streamId = id === null || id === undefined || id === '' ? null : String(id);
  const { frames } = useBulkStream('agent', streamId, { enabled: (options.enabled ?? true) && Boolean(streamId) });
  const consumedCountRef = useRef(0);
  const onMessageRef = useRef(onMessage);

  onMessageRef.current = onMessage;

  useEffect(() => {
    consumedCountRef.current = options.skipInitial ? frames.length : 0;
  }, [options.skipInitial, streamId]);

  useEffect(() => {
    if (!streamId || consumedCountRef.current >= frames.length) {
      return;
    }

    const nextFrames = frames.slice(consumedCountRef.current);
    consumedCountRef.current = frames.length;

    for (const frame of nextFrames) {
      if (!frame.data) {
        continue;
      }
      try {
        onMessageRef.current(JSON.parse(frame.data) as TMessage);
      } catch (error) {
        console.error('[useAgentBulkMessages] Failed to parse bulk agent frame:', error, frame.data);
      }
    }
  }, [frames, streamId]);
}
