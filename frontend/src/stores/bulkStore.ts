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
type FrameListener = (frame: BulkFrame) => void;

const framesByKey = new Map<string, BulkFrame[]>();
const listeners = new Map<string, Set<Listener>>();
const frameListeners = new Map<string, Set<FrameListener>>();
const EMPTY_FRAMES: BulkFrame[] = [];

export function appendBulkFrame(frame: BulkFrame): void {
  const key = bulkKey(frame.source, frame.id);
  const existing = framesByKey.get(key) ?? EMPTY_FRAMES;
  const insertAt = findFrameInsertIndex(existing, frame);
  const frames = [
    ...existing.slice(0, insertAt),
    frame,
    ...existing.slice(insertAt),
  ];
  framesByKey.set(key, frames);
  notifyFrame(key, frame);
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

export function subscribeBulkFrames(source: string, id: string, listener: FrameListener): () => void {
  const key = bulkKey(source, id);
  if (!frameListeners.has(key)) {
    frameListeners.set(key, new Set());
  }
  frameListeners.get(key)!.add(listener);
  return () => {
    frameListeners.get(key)?.delete(listener);
  };
}

function bulkKey(source: string, id: string): string {
  return `${source}/${id}`;
}

function findFrameInsertIndex(frames: BulkFrame[], frame: BulkFrame): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareBulkFrame(frames[mid], frame) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function compareBulkFrame(a: BulkFrame, b: BulkFrame): number {
  return a.seq - b.seq || (a.frameId ?? '').localeCompare(b.frameId ?? '');
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

function notifyFrame(key: string, frame: BulkFrame): void {
  frameListeners.get(key)?.forEach((listener) => listener(frame));
}
