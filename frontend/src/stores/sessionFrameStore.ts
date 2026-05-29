import type { ContentBlock, SessionFrame, SessionFrameRole } from '@/lib/session-frame/types';
import { applySessionRuntimeFrame } from './sessionRuntimeStore';

export interface SessionDisplayMessage {
  id: string;
  streamId: string;
  role?: SessionFrameRole;
  kind: SessionFrame['kind'];
  provider: string;
  seqStart: number;
  seqEnd: number;
  frameIds: string[];
  content: ContentBlock[];
  runtimeSessionId: string;
  providerSessionId?: string;
  parentToolUseId?: string;
  taskId?: string;
  toolUseId?: string;
  agentId?: string;
  sidechain?: boolean;
  error?: string;
  result?: string;
}

type Listener = () => void;

const framesByStream = new Map<string, SessionFrame[]>();
const frameIdsByStream = new Map<string, Set<string>>();
const messagesByStream = new Map<string, SessionDisplayMessage[]>();
const listeners = new Map<string, Set<Listener>>();
const EMPTY_FRAMES: SessionFrame[] = [];
const EMPTY_MESSAGES: SessionDisplayMessage[] = [];
const PROJECTCHAT_CONTEXT_SYNC_SUBTYPE = 'projectchat_context_sync';

export function appendSessionFrame(frame: SessionFrame): void {
  const ids = frameIdsFor(frame.streamId);
  if (ids.has(frame.frameId)) {
    return;
  }
  ids.add(frame.frameId);

  const frames = [...(framesByStream.get(frame.streamId) ?? []), frame]
    .sort(compareSessionFrames);
  framesByStream.set(frame.streamId, frames);
  messagesByStream.delete(frame.streamId);

  applySessionRuntimeFrame(frame);
  notify(frame.streamId);
}

export function replaceSessionFrames(streamId: string, frames: SessionFrame[]): void {
  framesByStream.delete(streamId);
  frameIdsByStream.delete(streamId);
  messagesByStream.delete(streamId);
  for (const frame of frames) {
    appendSessionFrame(frame);
  }
  notify(streamId);
}

export function clearSessionFrames(streamId: string): void {
  framesByStream.delete(streamId);
  frameIdsByStream.delete(streamId);
  messagesByStream.delete(streamId);
  notify(streamId);
}

export function getSessionFrames(streamId: string): SessionFrame[] {
  return framesByStream.get(streamId) ?? EMPTY_FRAMES;
}

export function getSessionMessages(streamId: string): SessionDisplayMessage[] {
  const cached = messagesByStream.get(streamId);
  if (cached) {
    return cached;
  }

  const messages: SessionDisplayMessage[] = [];

  for (const frame of getSessionFrames(streamId)) {
    if (frame.sidechain) {
      continue;
    }
    const previous = messages[messages.length - 1];
    if (canMergeDelta(previous, frame)) {
      previous.seqEnd = frame.seq;
      previous.frameIds.push(frame.frameId);
      previous.content = mergeContent(previous.content, frame.content);
      continue;
    }

    messages.push({
      id: frame.frameId,
      streamId: frame.streamId,
      role: frame.role,
      kind: frame.kind,
      provider: frame.provider,
      seqStart: frame.seq,
      seqEnd: frame.seq,
      frameIds: [frame.frameId],
      content: [...frame.content],
      runtimeSessionId: frame.runtimeSessionId,
      providerSessionId: frame.providerSessionId,
      parentToolUseId: frame.parentToolUseId,
      taskId: frame.taskId,
      toolUseId: frame.toolUseId,
      agentId: frame.agentId,
      sidechain: frame.sidechain,
      error: frame.error,
      result: frame.result,
    });
  }

  if (messages.length === 0) {
    return EMPTY_MESSAGES;
  }

  messagesByStream.set(streamId, messages);
  return messages;
}

export function subscribeSessionFrames(streamId: string, listener: Listener): () => void {
  return addListener(streamId, listener);
}

export function getSessionFrameSnapshot(streamId: string): SessionFrame[] {
  return getSessionFrames(streamId);
}

function canMergeDelta(previous: SessionDisplayMessage | undefined, frame: SessionFrame): previous is SessionDisplayMessage {
  return Boolean(
    previous &&
    previous.kind === 'delta' &&
    frame.kind === 'delta' &&
    previous.role === frame.role &&
    previous.parentToolUseId === frame.parentToolUseId &&
    previous.taskId === frame.taskId &&
    previous.sidechain === frame.sidechain &&
    textOnly(previous.content) &&
    textOnly(frame.content),
  );
}

function mergeContent(left: ContentBlock[], right: ContentBlock[]): ContentBlock[] {
  if (left.length === 0) {
    return [...right];
  }
  if (right.length === 0) {
    return [...left];
  }
  const merged = [...left];
  const last = merged[merged.length - 1];
  const first = right[0];
  if (last.type === 'text' && first.type === 'text') {
    merged[merged.length - 1] = { ...last, text: last.text + first.text };
    merged.push(...right.slice(1));
    return merged;
  }
  merged.push(...right);
  return merged;
}

function textOnly(content: ContentBlock[]): boolean {
  return content.every((block) => block.type === 'text');
}

export function getProjectChatMessages(
  segments: Array<{ streamId: string; seq: number }>
): SessionDisplayMessage[] {
  const sorted = [...segments].sort((a, b) => a.seq - b.seq);
  const allMessages: SessionDisplayMessage[] = [];
  for (const segment of sorted) {
    const segmentMessages = getSessionMessages(segment.streamId);
    allMessages.push(...segmentMessages);
  }
  return allMessages;
}

function frameIdsFor(streamId: string): Set<string> {
  let ids = frameIdsByStream.get(streamId);
  if (!ids) {
    ids = new Set();
    frameIdsByStream.set(streamId, ids);
  }
  return ids;
}

function addListener(streamId: string, listener: Listener): () => void {
  if (!listeners.has(streamId)) {
    listeners.set(streamId, new Set());
  }
  listeners.get(streamId)!.add(listener);
  return () => {
    listeners.get(streamId)?.delete(listener);
  };
}

function notify(streamId: string): void {
  listeners.get(streamId)?.forEach((listener) => listener());
}

function compareSessionFrames(a: SessionFrame, b: SessionFrame): number {
  if (a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  const priority = framePriority(a) - framePriority(b);
  if (priority !== 0) {
    return priority;
  }
  return a.frameId.localeCompare(b.frameId);
}

function framePriority(frame: SessionFrame): number {
  if (frame.subtype === PROJECTCHAT_CONTEXT_SYNC_SUBTYPE) {
    return 10;
  }
  if (frame.kind === 'init' || frame.subtype === 'init' || frame.subtype === 'thread_created') {
    return 0;
  }
  return 5;
}
