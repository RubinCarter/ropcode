export interface SyncEvent {
  type: string;
  projectId?: string;
  sessionId?: string;
  provider?: string;
  summary?: Record<string, unknown>;
}

type Listener = () => void;

let events: SyncEvent[] = [];
const listeners = new Set<Listener>();
const EMPTY_EVENTS: SyncEvent[] = [];

export function appendSyncEvent(event: SyncEvent): void {
  events = [...events, event];
  listeners.forEach((listener) => listener());
}

export function clearSyncEvents(): void {
  events = EMPTY_EVENTS;
  listeners.forEach((listener) => listener());
}

export function getSyncEvents(): SyncEvent[] {
  return events;
}

export function getLatestSyncEvent(): SyncEvent | undefined {
  return events.at(-1);
}

export function subscribeSyncEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
