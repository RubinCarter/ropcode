import { useEffect, useRef } from 'react';
import { getSessionFrames, subscribeSessionFrames } from '@/stores/sessionFrameStore';
import type { SessionFrame } from '@/lib/session-frame/types';

export function useSessionFrameMessages(
  streamId: string | null | undefined,
  onMessage: (payload: string) => void,
  options: { skipInitial?: boolean } = {},
): void {
  const consumedCountRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!streamId) {
      consumedCountRef.current = 0;
      return;
    }

    const frames = getSessionFrames(streamId);
    consumedCountRef.current = options.skipInitial ? frames.length : 0;

    const consumeFrames = () => {
      const nextFrames = getSessionFrames(streamId);
      if (consumedCountRef.current >= nextFrames.length) {
        return;
      }
      const pending = nextFrames.slice(consumedCountRef.current);
      consumedCountRef.current = nextFrames.length;
      for (const frame of pending) {
        const payload = legacyPayloadFromFrame(frame);
        if (payload) {
          onMessageRef.current(payload);
        }
      }
    };

    consumeFrames();
    return subscribeSessionFrames(streamId, consumeFrames);
  }, [options.skipInitial, streamId]);
}

function legacyPayloadFromFrame(frame: SessionFrame): string | null {
  const raw = frame.meta?.raw as Record<string, unknown> | undefined;
  if (typeof raw?.raw === 'string') {
    return raw.raw;
  }
  if (raw && Object.keys(raw).length > 0) {
    return JSON.stringify(raw);
  }
  return JSON.stringify(sessionFrameToLegacyMessage(frame));
}

function sessionFrameToLegacyMessage(frame: SessionFrame): Record<string, unknown> {
  return {
    type: frame.kind === 'init' ? 'system' : frame.role || 'assistant',
    subtype: frame.subtype,
    session_id: frame.runtimeSessionId,
    cwd: frame.cwd || frame.projectPath,
    provider: frame.provider,
    timestamp: frame.timestamp,
    result: frame.result,
    is_error: frame.isError,
    message: frame.content.length > 0 ? { content: frame.content.map(legacyContentBlock) } : undefined,
    usage: frame.usage,
    debug_meta: frame.runtime ? { runtime_state: frame.runtime } : undefined,
  };
}

function legacyContentBlock(block: SessionFrame['content'][number]): Record<string, unknown> {
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.toolUseId,
      name: block.name,
      input: block.input,
    };
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.toolUseId,
      content: block.text ?? block.output,
      is_error: block.isError,
    };
  }
  return { ...block };
}
