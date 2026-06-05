import type { RuntimeSnapshot, SessionFrame } from '@/lib/session-frame/types';

export interface SessionRuntimeState {
  streamId: string;
  connected: boolean;
  lastSeq: number;
  lastFrameId?: string;
  lastUpdatedAt?: number;
  runtime?: RuntimeSnapshot;
  error?: string;
}

type Listener = () => void;

const states = new Map<string, SessionRuntimeState>();
const listeners = new Map<string, Set<Listener>>();
const emptyStates = new Map<string, SessionRuntimeState>();

export function getSessionRuntime(streamId: string): SessionRuntimeState {
  const existing = states.get(streamId);
  if (existing) return existing;
  let empty = emptyStates.get(streamId);
  if (!empty) {
    empty = { streamId, connected: false, lastSeq: 0 };
    emptyStates.set(streamId, empty);
  }
  return empty;
}

export function setSessionRuntimeConnected(streamId: string, connected: boolean): void {
  const previous = getSessionRuntime(streamId);
  states.set(streamId, {
    ...previous,
    connected,
    lastUpdatedAt: Date.now(),
  });
  notify(streamId);
}

export function applySessionRuntimeFrame(frame: SessionFrame): void {
  if (frame.sidechain) {
    return;
  }

  const previous = getSessionRuntime(frame.streamId);
  const nextRuntime = frame.runtime ?? terminalRuntimeFromFrame(frame);
  const previousRuntimeIsTerminal = isTerminalRuntime(previous.runtime?.phase);
  states.set(frame.streamId, {
    ...previous,
    streamId: frame.streamId,
    lastSeq: Math.max(previous.lastSeq, frame.seq),
    lastFrameId: frame.frameId,
    lastUpdatedAt: Date.now(),
    runtime: nextRuntime ?? (frame.seq > previous.lastSeq && previousRuntimeIsTerminal ? undefined : previous.runtime),
    error: frame.error ?? previous.error,
  });
  notify(frame.streamId);
}

function isTerminalRuntime(phase: string | undefined): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

function terminalRuntimeFromFrame(frame: SessionFrame): RuntimeSnapshot | null {
  if (frame.kind === 'result') {
    return {
      phase: frame.isError ? 'failed' : 'completed',
      waitingOn: frame.error ?? null,
    };
  }

  const raw = frame.meta?.raw as Record<string, unknown> | undefined;
  const rawMessage = raw?.message as Record<string, unknown> | undefined;
  const stopReason = rawMessage?.stop_reason ?? raw?.stop_reason;
  if (frame.role === 'assistant' && stopReason === 'end_turn') {
    return {
      phase: 'completed',
      waitingOn: null,
    };
  }

  return null;
}

export function clearSessionRuntime(streamId: string): void {
  states.delete(streamId);
  notify(streamId);
}

export function subscribeSessionRuntime(streamId: string, listener: Listener): () => void {
  return addListener(listeners, streamId, listener);
}

function notify(streamId: string): void {
  listeners.get(streamId)?.forEach((listener) => listener());
}

function addListener(map: Map<string, Set<Listener>>, key: string, listener: Listener): () => void {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key)!.add(listener);
  return () => {
    map.get(key)?.delete(listener);
  };
}
