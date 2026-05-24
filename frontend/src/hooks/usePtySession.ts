import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { EventsOn } from '@/lib/rpc-events';
import { api } from '@/lib/api';
import { useBulkStream } from './useBulkStream';

type UnlistenFn = () => void;

interface PtyReadyEvent {
  session_id: string;
  success: boolean;
  error?: string;
}

/**
 * PTY session manager
 * Manages PTY session lifecycle, ensuring each session is created only once
 */
class PtySessionManager {
  private sessions = new Map<string, {
    created: boolean;
    pending: boolean; // Waiting for backend async startup
    ready: boolean; // Backend PTY is ready
    cwd: string | undefined;
    rows: number;
    cols: number;
    listeners: Set<string>; // Listener ID set
    readyCallbacks: Array<(success: boolean, error?: string) => void>;
  }>();

  private readyUnsubscribe: (() => void) | null = null;

  constructor() {
    // Listen for pty-ready event
    this.readyUnsubscribe = EventsOn('pty-ready', (payload: PtyReadyEvent) => {
      const { session_id, success, error } = payload;
      console.log('[PtyManager] Received pty-ready event:', { session_id, success, error });

      const session = this.sessions.get(session_id);
      if (session) {
        session.pending = false;
        session.ready = success;
        // Trigger all callbacks
        session.readyCallbacks.forEach(cb => cb(success, error));
        session.readyCallbacks = [];
      }
    });
  }

  /**
   * Create or get a PTY session
   * Non-blocking - RPC call returns immediately, shell starts in background
   */
  async getOrCreate(
    sessionId: string,
    cwd: string | undefined,
    rows: number,
    cols: number
  ): Promise<void> {
    let session = this.sessions.get(sessionId);

    if (session?.created) {
      console.log('[PtyManager] PTY session already exists:', sessionId);
      return;
    }

    // If already waiting for backend startup, return immediately (non-blocking)
    if (session?.pending) {
      console.log('[PtyManager] PTY session is already starting:', sessionId);
      return;
    }

    // Save session info
    this.sessions.set(sessionId, {
      created: true,
      pending: true,
      ready: false,
      cwd,
      rows,
      cols,
      listeners: new Set(),
      readyCallbacks: [],
    });

    try {
      console.log('[PtyManager] Creating PTY session asynchronously:', { sessionId, cwd, rows, cols });

      // RPC call returns immediately without waiting for shell startup
      await api.createPtySession(
        sessionId,
        cwd || undefined,
        rows,
        cols,
        undefined
      );

      console.log('[PtyManager] PTY session create request sent:', sessionId);
    } catch (error) {
      console.error('[PtyManager] Failed to create PTY session:', sessionId, error);
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Wait for PTY to be ready
   */
  waitForReady(sessionId: string, timeoutMs: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error(`Session not found: ${sessionId}`));
        return;
      }

      if (session.ready) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`PTY session timeout: ${sessionId}`));
      }, timeoutMs);

      session.readyCallbacks.push((success, error) => {
        clearTimeout(timeout);
        if (success) {
          resolve();
        } else {
          reject(new Error(error || 'PTY session failed'));
        }
      });
    });
  }

  /**
   * Check if PTY is ready
   */
  isReady(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.ready || false;
  }

  /**
   * Resize PTY dimensions
   */
  async resize(sessionId: string, rows: number, cols: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.created) {
      console.warn('[PtyManager] PTY session does not exist or was not created, skipping resize:', sessionId);
      return;
    }

    // If PTY is not ready yet, skip resize (backend will use dimensions from creation)
    if (!session.ready) {
      console.log('[PtyManager] PTY is not ready yet, skipping resize:', sessionId);
      session.rows = rows;
      session.cols = cols;
      return;
    }

    try {
      await api.resizePty(sessionId, rows, cols);
      session.rows = rows;
      session.cols = cols;
      console.log('[PtyManager] PTY size adjusted:', { sessionId, rows, cols });
    } catch (error) {
      console.error('[PtyManager] Failed to resize PTY:', sessionId, error);
    }
  }

  /**
   * Close PTY session
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn('[PtyManager] PTY session does not exist:', sessionId);
      return;
    }

    try {
      console.log('[PtyManager] Closing PTY session:', sessionId);
      await api.closePtySession(sessionId);
      this.sessions.delete(sessionId);
    } catch (error) {
      console.error('[PtyManager] Failed to close PTY session:', sessionId, error);
      // Remove from manager even on failure
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Register listener
   */
  registerListener(sessionId: string, listenerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.add(listenerId);
      console.log('[PtyManager] Registered listener:', { sessionId, listenerId, count: session.listeners.size });
    }
  }

  /**
   * Unregister listener
   */
  unregisterListener(sessionId: string, listenerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.delete(listenerId);
      console.log('[PtyManager] Unregistered listener:', { sessionId, listenerId, count: session.listeners.size });
    }
  }

  /**
   * Get listener count
   */
  getListenerCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.listeners.size || 0;
  }

  /**
   * Check if session exists
   */
  has(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.created || false;
  }

  /**
   * Clear all sessions
   */
  async clear(): Promise<void> {
    console.log('[PtyManager] Clearing all sessions');
    const promises = Array.from(this.sessions.keys()).map(id => this.close(id));
    await Promise.allSettled(promises);
  }
}

// Global singleton
const ptySessionManager = new PtySessionManager();

interface UsePtySessionOptions {
  sessionId: string;
  workspaceId: string;
  cwd?: string;
  terminal: Terminal | null | undefined;
  rows: number;
  cols: number;
  onExit?: () => void;
}

/**
 * PTY session management hook
 */
export function usePtySession(options: UsePtySessionOptions) {
  const {
    sessionId,
    workspaceId,
    cwd,
    terminal,
    rows,
    cols,
    onExit,
  } = options;

  const [isReady, setIsReady] = useState(false);
  const initializedRef = useRef(false);
  const dataHandlerRef = useRef<((data: string) => Promise<void>) | null>(null);
  const listenerIdRef = useRef<string>(`${workspaceId}::${sessionId}::${Date.now()}`);
  const inputDisposableRef = useRef<any>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const readyUnsubscribeRef = useRef<(() => void) | null>(null);
  const consumedBulkCountRef = useRef(0);
  const { frames: bulkFrames } = useBulkStream('pty', sessionId, { enabled: Boolean(terminal) });

  useEffect(() => {
    if (!terminal) return;
    for (const frame of bulkFrames.slice(consumedBulkCountRef.current)) {
      try {
        terminal.write(frame.data ?? '');
      } catch (error) {
        console.error('[usePtySession] Failed to write to Terminal:', error);
      }
    }
    consumedBulkCountRef.current = bulkFrames.length;
  }, [bulkFrames, terminal]);

  // Unified init flow: set up listeners first, then create PTY session
  useEffect(() => {
    console.log('[usePtySession] useEffect triggered:', { sessionId, terminalExists: !!terminal, initialized: initializedRef.current });
    if (!terminal || initializedRef.current) return;

    const init = async () => {
      try {
        console.log('[usePtySession] Starting initialization:', sessionId);

        // 1. Set up PTY output listener (must be before PTY creation)
        const listenerId = listenerIdRef.current;
        ptySessionManager.registerListener(sessionId, listenerId);

        // Listen for pty-ready event to update isReady state
        const readyUnsubscribe = EventsOn('pty-ready', (payload: PtyReadyEvent) => {
          if (payload.session_id === sessionId) {
            if (payload.success) {
              console.log('[usePtySession] PTY is ready:', sessionId);
              setIsReady(true);
            } else {
              console.error('[usePtySession] PTY failed to start:', payload.error);
              terminal?.writeln(`\x1b[1;31mError: ${payload.error || 'Failed to start PTY'}\x1b[0m`);
            }
          }
        });
        readyUnsubscribeRef.current = readyUnsubscribe;

        console.log('[usePtySession] PTY bulk output listener is set:', { sessionId, listenerId });

        // 2. Set up input handler
        const handleData = async (data: string) => {
          try {
            await api.writeToPty(sessionId, data);
          } catch (error) {
            console.error('[usePtySession] Failed to write to PTY:', error);
          }
        };

        dataHandlerRef.current = handleData;
        inputDisposableRef.current = terminal.onData(handleData);

        // 3. Create PTY session (non-blocking, returns immediately)
        const dims = terminal.rows && terminal.cols
          ? { rows: terminal.rows, cols: terminal.cols }
          : { rows, cols };

        console.log('[usePtySession] Creating PTY session asynchronously:', { sessionId, dims });
        await ptySessionManager.getOrCreate(sessionId, cwd, dims.rows, dims.cols);

        initializedRef.current = true;
        console.log('[usePtySession] PTY create request sent, waiting for pty-ready event:', sessionId);
      } catch (error) {
        console.error('[usePtySession] Failed to initialize PTY session:', error);
        terminal?.writeln('\x1b[1;31mError: Failed to create PTY session\x1b[0m');
      }
    };

    init();

    return () => {
      console.log('[usePtySession] Cleaning up PTY session:', sessionId);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      readyUnsubscribeRef.current?.();
      readyUnsubscribeRef.current = null;
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      dataHandlerRef.current = null;
      const listenerId = listenerIdRef.current;
      ptySessionManager.unregisterListener(sessionId, listenerId);
    };
  }, [sessionId, cwd, terminal, rows, cols, onExit]);

  // Handle size changes
  useEffect(() => {
    if (!terminal || !initializedRef.current) return;

    const handleResize = async () => {
      if (terminal.rows && terminal.cols) {
        await ptySessionManager.resize(sessionId, terminal.rows, terminal.cols);
      }
    };

    // Initial resize (after PTY creation)
    handleResize();

    // Observe container size changes
    let resizeRaf: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          handleResize();
        });
      }
    });

    // Find the Terminal's container element
    const container = (terminal as any).element?.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [sessionId, terminal, initializedRef.current]);

  return {
    isReady,
    sessionId,
  };
}

// Export manager for use elsewhere
export { ptySessionManager };
