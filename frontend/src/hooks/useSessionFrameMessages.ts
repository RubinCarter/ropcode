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
      console.log('[useSessionFrameMessages] No streamId, resetting');
      consumedCountRef.current = 0;
      return;
    }

    console.log('[useSessionFrameMessages] Subscribing to streamId:', streamId, 'skipInitial:', options.skipInitial);
    const frames = getSessionFrames(streamId);
    console.log('[useSessionFrameMessages] Initial frames count:', frames.length);
    consumedCountRef.current = options.skipInitial ? frames.length : 0;

    const consumeFrames = () => {
      const nextFrames = getSessionFrames(streamId);
      if (consumedCountRef.current >= nextFrames.length) {
        return;
      }
      const pending = nextFrames.slice(consumedCountRef.current);
      consumedCountRef.current = nextFrames.length;
      console.log('[useSessionFrameMessages] Consuming', pending.length, 'frames for streamId:', streamId);
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

export function legacyPayloadFromFrame(frame: SessionFrame): string | null {
  if (frame.sidechain) {
    return null;
  }
  const raw = frame.meta?.raw as Record<string, unknown> | undefined;
  if (typeof raw?.raw === 'string') {
    return raw.raw;
  }
  if (raw && Object.keys(raw).length > 0) {
    const payload = withFrameSemantics(frame, withFrameRuntimeIdentity(frame, raw));
    return JSON.stringify(payload);
  }
  const payload = withFrameSemantics(frame, sessionFrameToLegacyMessage(frame));
  return JSON.stringify(payload);
}

function withFrameRuntimeIdentity(frame: SessionFrame, payload: Record<string, unknown>): Record<string, unknown> {
  const debugMeta = isRecord(payload.debug_meta) ? payload.debug_meta : {};
  const runtimeState = frame.runtime ? { runtime_state: frame.runtime } : {};
  return {
    ...payload,
    runtime_session_id: frame.runtimeSessionId,
    provider: frame.provider,
    cwd: payload.cwd ?? frame.cwd ?? frame.projectPath,
    debug_meta: {
      ...debugMeta,
      ...runtimeState,
    },
  };
}

function withFrameSemantics(frame: SessionFrame, payload: Record<string, unknown>): Record<string, unknown> {
  if (frame.kind !== 'delta') {
    return payload;
  }
  return {
    ...payload,
    is_delta: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
