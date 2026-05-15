export interface LogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

function serialize(args: unknown[]): string[] {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  });
}

function push(level: LogEntry['level'], args: unknown[]) {
  const serializedArgs = serialize(args);
  entries.push({ timestamp: Date.now(), level, args: serializedArgs });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  window.electronAPI?.writeRendererLog?.(level, 'renderer-debug-log', serializedArgs);
  listeners.forEach(fn => fn());
}

// Patch console methods once
const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

console.log = (...a: unknown[]) => { push('log', a); orig.log(...a); };
console.warn = (...a: unknown[]) => { push('warn', a); orig.warn(...a); };
console.error = (...a: unknown[]) => { push('error', a); orig.error(...a); };
console.info = (...a: unknown[]) => { push('info', a); orig.info(...a); };
console.debug = (...a: unknown[]) => { push('debug', a); orig.debug(...a); };

// Capture unhandled errors & rejections
window.addEventListener('error', (e) => {
  push('error', [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`]);
});
window.addEventListener('unhandledrejection', (e) => {
  push('error', [`[UnhandledRejection] ${e.reason}`]);
});

export const debugLog = {
  getEntries: () => entries,
  clear: () => { entries.length = 0; listeners.forEach(fn => fn()); },
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
