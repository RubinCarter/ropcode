export interface BulkFrame {
  source: string;
  id: string;
  frameId?: string;
  seq: number;
  timestamp?: string;
  data?: string;
  meta?: Record<string, unknown>;
}

type Listener = () => void;

const framesByKey = new Map<string, BulkFrame[]>();
const listeners = new Map<string, Set<Listener>>();
const EMPTY_FRAMES: BulkFrame[] = [];

export function appendBulkFrame(frame: BulkFrame): void {
  const key = bulkKey(frame.source, frame.id);
  const frames = [...(framesByKey.get(key) ?? []), frame]
    .sort((a, b) => a.seq - b.seq || (a.frameId ?? '').localeCompare(b.frameId ?? ''));
  framesByKey.set(key, frames);
  notify(key);
}

export function clearBulkFrames(source: string, id: string): void {
  const key = bulkKey(source, id);
  framesByKey.delete(key);
  notify(key);
}

export function getBulkFrames(source: string, id: string): BulkFrame[] {
  return framesByKey.get(bulkKey(source, id)) ?? EMPTY_FRAMES;
}

export function getBulkText(source: string, id: string): string {
  return getBulkFrames(source, id).map((frame) => frame.data ?? '').join('');
}

export function subscribeBulk(source: string, id: string, listener: Listener): () => void {
  const key = bulkKey(source, id);
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key)!.add(listener);
  return () => {
    listeners.get(key)?.delete(listener);
  };
}

function bulkKey(source: string, id: string): string {
  return `${source}/${id}`;
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}
