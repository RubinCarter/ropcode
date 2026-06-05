import type { ProjectChatSegmentSeed } from '@/lib/projectChatSession';

export type ProjectChatSegment = ProjectChatSegmentSeed;

type Listener = () => void;

const EMPTY_SEGMENTS: ProjectChatSegment[] = [];
const projectChatSegmentsByChatId = new Map<string, ProjectChatSegment[]>();
const listenersByChatId = new Map<string, Set<Listener>>();

export function getProjectChatSegments(chatId: string | null | undefined): ProjectChatSegment[] {
  if (!chatId) {
    return EMPTY_SEGMENTS;
  }
  return projectChatSegmentsByChatId.get(chatId) ?? EMPTY_SEGMENTS;
}

export function setProjectChatSegments(chatId: string, segments: ProjectChatSegment[]): void {
  projectChatSegmentsByChatId.set(chatId, sortSegments(segments));
  notify(chatId);
}

export function upsertProjectChatSegment(chatId: string, segment: ProjectChatSegment): ProjectChatSegment[] {
  const current = getProjectChatSegments(chatId);
  const existingIndex = current.findIndex((item) => item.id === segment.id);
  const next = existingIndex >= 0
    ? [
        ...current.slice(0, existingIndex),
        { ...current[existingIndex], ...segment },
        ...current.slice(existingIndex + 1),
      ]
    : [...current, segment];
  setProjectChatSegments(chatId, next);
  return getProjectChatSegments(chatId);
}

export function updateProjectChatSegmentRuntimeSession(
  chatId: string,
  segmentId: string,
  runtimeSessionId: string,
): ProjectChatSegment[] {
  const current = getProjectChatSegments(chatId);
  const next = current.map((segment) =>
    segment.id === segmentId
      ? { ...segment, runtimeSessionId }
      : segment
  );
  setProjectChatSegments(chatId, next);
  return getProjectChatSegments(chatId);
}

export function clearProjectChatSegments(chatId: string): void {
  projectChatSegmentsByChatId.delete(chatId);
  notify(chatId);
}

export function subscribeProjectChatSegments(
  chatId: string | null | undefined,
  listener: Listener,
): () => void {
  if (!chatId) {
    return () => undefined;
  }
  if (!listenersByChatId.has(chatId)) {
    listenersByChatId.set(chatId, new Set());
  }
  listenersByChatId.get(chatId)!.add(listener);
  return () => {
    listenersByChatId.get(chatId)?.delete(listener);
  };
}

function sortSegments(segments: ProjectChatSegment[]): ProjectChatSegment[] {
  return [...segments].sort((left, right) => {
    if (left.seq !== right.seq) {
      return left.seq - right.seq;
    }
    return left.id.localeCompare(right.id);
  });
}

function notify(chatId: string): void {
  listenersByChatId.get(chatId)?.forEach((listener) => listener());
}
