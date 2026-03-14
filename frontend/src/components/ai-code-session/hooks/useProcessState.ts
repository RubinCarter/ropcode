/**
 * Process state synchronization hook
 *
 * Manages process execution state including:
 * - Loading/execution state
 * - Pending send state
 * - Process state event subscription
 * - State synchronization with backend
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/ws-rpc-client";
import { useProcessChanged } from "@/hooks";

export interface UseProcessStateOptions {
  projectPath: string;
  provider?: string;  // Provider ID (claude, codex, etc.)
}

export interface UseProcessStateReturn {
  // State
  isLoading: boolean;
  isPendingSend: boolean;
  hasActiveSessionRef: React.MutableRefObject<boolean>;
  isPendingSendRef: React.MutableRefObject<boolean>;
  interactiveSessionId: string | null;
  interactiveSessionIdRef: React.MutableRefObject<string | null>;

  // Setters
  setIsLoading: (loading: boolean) => void;
  setIsPendingSend: (pending: boolean) => void;
  setInteractiveSessionId: (sessionId: string | null) => void;

  // Actions
  syncProcessState: () => Promise<void>;
}

/**
 * Hook to manage process state
 */
export function useProcessState(options: UseProcessStateOptions): UseProcessStateReturn {
  const { projectPath, provider = 'claude' } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [isPendingSend, setIsPendingSend] = useState(false);
  const [interactiveSessionId, setInteractiveSessionId] = useState<string | null>(null);

  // Refs for stable access
  const hasActiveSessionRef = useRef(false);
  const isPendingSendRef = useRef(isPendingSend);
  isPendingSendRef.current = isPendingSend;

  // Ref for interactiveSessionId to avoid stale closures
  const interactiveSessionIdRef = useRef<string | null>(null);
  interactiveSessionIdRef.current = interactiveSessionId;

  // Wrap setInteractiveSessionId to also update ref immediately
  // This prevents race conditions where useProcessChanged reads the ref
  // before the state update has rendered
  const setInteractiveSessionIdWithRef = useCallback((sessionId: string | null) => {
    interactiveSessionIdRef.current = sessionId;
    setInteractiveSessionId(sessionId);
  }, []);

  /**
   * Sync process state with backend
   * Queries actual process state from ProcessRegistry
   *
   * In interactive mode, process is always "running" but that doesn't mean
   * AI is actively generating. Skip overriding isLoading in interactive mode.
   */
  const syncProcessState = useCallback(async () => {
    if (!projectPath) {
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      return;
    }

    // Don't sync if we're pending a send - let the process register first
    if (isPendingSendRef.current) {
      return;
    }

    try {
      const running = await api.isClaudeSessionRunningForProject(projectPath, provider);
      hasActiveSessionRef.current = running;

      // In interactive mode, process is always running but isLoading
      // should only reflect "AI is actively generating a response",
      // which is controlled by message flow (send -> result), not process state.
      if (!interactiveSessionIdRef.current) {
        setIsLoading(running);
      }
    } catch {
      // Keep current state on error
    }
  }, [projectPath, provider]);

  // Sync on mount, when project path changes, and on WebSocket reconnect
  // (reconnect sync catches missed process:changed events while disconnected)
  useEffect(() => {
    syncProcessState();
    const unsub = wsClient.onConnect(() => {
      syncProcessState();
    });
    return unsub;
  }, [syncProcessState]);

  // Subscribe to process state changes via event system
  // Note: useEventSubscription internally uses queueMicrotask to avoid flushSync warnings
  useProcessChanged(projectPath, (event) => {
    if (event.state === "running") {
      hasActiveSessionRef.current = true;
      // In interactive mode, don't set isLoading based on process state.
      // isLoading is controlled by message flow (send -> result).
      if (!interactiveSessionIdRef.current) {
        setIsLoading(true);
      }
    } else if (event.state === "stopped") {
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      // Process terminated, clear interactive session
      setInteractiveSessionIdWithRef(null);
    }
  });

  return {
    isLoading,
    isPendingSend,
    hasActiveSessionRef,
    isPendingSendRef,
    interactiveSessionId,
    interactiveSessionIdRef,
    setIsLoading,
    setIsPendingSend,
    setInteractiveSessionId: setInteractiveSessionIdWithRef,
    syncProcessState,
  };
}
