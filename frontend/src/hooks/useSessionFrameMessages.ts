import { useEffect, useRef } from 'react';
import { getSessionFrames, subscribeSessionFrames } from '@/stores/sessionFrameStore';
import type { SessionFrame } from '@/lib/session-frame/types';

export function useSessionFrameMessages(
  streamId: string | null | undefined,
  onMessage: (payload: string) => void,
  options: { skipInitial?: boolean } = {},
): void {
  const consumedFrameKeysRef = useRef<Set<string>>(new Set());
  const subscribedStreamIdRef = useRef<string | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!streamId) {
      consumedFrameKeysRef.current.clear();
      subscribedStreamIdRef.current = null;
      return;
    }

    if (subscribedStreamIdRef.current !== streamId) {
      consumedFrameKeysRef.current.clear();
      subscribedStreamIdRef.current = streamId;
    }

    const frames = getSessionFrames(streamId);
    if (options.skipInitial) {
      for (const frame of frames) {
        consumedFrameKeysRef.current.add(sessionFrameConsumptionKey(frame));
      }
    }

    const consumeFrames = () => {
      const nextFrames = getSessionFrames(streamId);
      const pending = getUnconsumedSessionFrames(nextFrames, consumedFrameKeysRef.current);
      if (pending.length === 0) return;
      for (const frame of pending) {
        consumedFrameKeysRef.current.add(sessionFrameConsumptionKey(frame));
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

export function getUnconsumedSessionFrames(
  frames: SessionFrame[],
  consumedFrameKeys: ReadonlySet<string>,
): SessionFrame[] {
  return frames.filter((frame) => !consumedFrameKeys.has(sessionFrameConsumptionKey(frame)));
}

export function sessionFrameConsumptionKey(frame: SessionFrame): string {
  if (frame.operation !== 'upsert') {
    return frame.frameId;
  }
  return [
    frame.frameId,
    frame.messageId ?? '',
    frame.operation,
    frameContentFingerprint(frame),
  ].join(':');
}

export function legacyPayloadFromFrame(frame: SessionFrame): string | null {
  if (frame.sidechain) {
    return null;
  }
  const raw = frame.meta?.raw as Record<string, unknown> | undefined;
  if (isHiddenByDefault(raw)) {
    return null;
  }
  if (typeof raw?.raw === 'string') {
    return raw.raw;
  }
  if (raw && Object.keys(raw).length > 0) {
    const payload = withFrameSemantics(frame, withFrameContentIdentity(frame, withFrameMessageIdentity(frame, withFrameRuntimeIdentity(frame, raw))));
    return JSON.stringify(payload);
  }
  const payload = withFrameSemantics(frame, withFrameMessageIdentity(frame, sessionFrameToLegacyMessage(frame)));
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
  if (frame.kind === 'result' && (payload.type === 'result' || frame.isError || frame.error)) {
    return {
      ...payload,
      type: 'result',
      subtype: payload.subtype ?? (frame.isError ? 'error' : 'success'),
      is_error: payload.is_error ?? frame.isError,
      error: payload.error ?? frame.error,
    };
  }
  if (frame.kind !== 'delta') {
    return payload;
  }
  return {
    ...payload,
    is_delta: true,
  };
}

function withFrameMessageIdentity(frame: SessionFrame, payload: Record<string, unknown>): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = { ...payload };
  if (frame.messageId) {
    nextPayload.message_id = nextPayload.message_id ?? frame.messageId;
    if (isRecord(nextPayload.message)) {
      nextPayload.message = {
        ...nextPayload.message,
        id: nextPayload.message.id ?? frame.messageId,
      };
    }
  }
  if (frame.operation) {
    nextPayload.frame_operation = nextPayload.frame_operation ?? frame.operation;
  }
  return nextPayload;
}

function withFrameContentIdentity(frame: SessionFrame, payload: Record<string, unknown>): Record<string, unknown> {
  if (frame.content.length === 0 || !isRecord(payload.message)) {
    return payload;
  }
  const rawContent = Array.isArray(payload.message.content) ? payload.message.content : null;
  if (!rawContent || rawContent.length !== frame.content.length) {
    return payload;
  }

  const content = rawContent.map((block, index) => {
    if (!isRecord(block)) return block;
    const frameBlock = frame.content[index];
    if (block.type === 'tool_use' && frameBlock?.type === 'tool_use' && frameBlock.toolUseId) {
      return { ...block, id: block.id ?? frameBlock.toolUseId };
    }
    if (block.type === 'tool_result' && frameBlock?.type === 'tool_result' && frameBlock.toolUseId) {
      return { ...block, tool_use_id: block.tool_use_id ?? frameBlock.toolUseId };
    }
    return block;
  });

  return {
    ...payload,
    message: {
      ...payload.message,
      content,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHiddenByDefault(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) {
    return false;
  }
  if (payload.hidden_by_default === true) {
    return true;
  }
  const debugMeta = isRecord(payload.debug_meta) ? payload.debug_meta : undefined;
  return debugMeta?.hidden_by_default === true;
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
    error: frame.error,
    is_error: frame.isError,
    message: frame.content.length > 0 ? { id: frame.messageId, content: frame.content.map(legacyContentBlock) } : undefined,
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

function frameContentFingerprint(frame: SessionFrame): string {
  return frame.content.map((block) => {
    if (block.type === 'text') {
      return `text:${block.text.length}:${block.text}`;
    }
    if (block.type === 'thinking') {
      return `thinking:${block.text.length}:${block.text}`;
    }
    if (block.type === 'tool_use') {
      return `tool:${block.toolUseId}:${block.name}`;
    }
    if (block.type === 'tool_result') {
      return `result:${block.toolUseId}:${block.text ?? JSON.stringify(block.output ?? null)}`;
    }
    return JSON.stringify(block);
  }).join('|');
}
