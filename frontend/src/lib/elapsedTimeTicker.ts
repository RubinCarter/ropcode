type Listener = (now: number) => void;

let interval: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

function start() {
  if (interval) return;
  interval = setInterval(() => {
    const now = Date.now();
    listeners.forEach(fn => fn(now));
  }, 100);
}

function stop() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

export function subscribeElapsedTick(fn: Listener): () => void {
  listeners.add(fn);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}
