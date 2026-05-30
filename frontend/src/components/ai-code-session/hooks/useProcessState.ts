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
  activeRuntimeSessionId?: string | null;
}

export interface UseProcessStateReturn {
  // State
  isLoading: boolean;
  isPendingSend: boolean;
  hasActiveSessionRef: React.MutableRefObject<boolean>;
  isPendingSendRef: React.MutableRefObject<boolean>;
  interactiveSessionId: string | null;
  interactiveSessionIdRef: React.MutableRefObject<string | null>;
  loadingStartedAt: number | null;

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
  const { projectPath, provider = 'claude', activeRuntimeSessionId } = options;

  const [isLoading, setIsLoadingState] = useState(false);
  const [isPendingSend, setIsPendingSend] = useState(false);
  const [interactiveSessionId, setInteractiveSessionId] = useState<string | null>(null);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);

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

  const setIsLoading = useCallback((loading: boolean) => {
    setIsLoadingState((current) => {
      if (current === loading) {
        return current;
      }
      return loading;
    });

    if (loading) {
      setLoadingStartedAt((current) => current ?? Date.now());
    } else {
      setLoadingStartedAt(null);
    }
  }, []);

  const syncProcessState = useCallback(async () => {
    if (!projectPath) {
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      return;
    }

    if (activeRuntimeSessionId === null && !isPendingSendRef.current) {
      setIsLoading(false);
      hasActiveSessionRef.current = false;
      return;
    }

    // Don't sync if we're pending a send - let the process register first
    if (isPendingSendRef.current) {
      return;
    }

    try {
      const activity = await api.queryProviderSessionActivityForProject(
        projectPath,
        interactiveSessionIdRef.current || provider
      );
      const running = Boolean(activity?.running);
      const active = Boolean(activity?.active);
      hasActiveSessionRef.current = running;

      setIsLoading(active);
    } catch {
      // Keep current state on error
    }
  }, [activeRuntimeSessionId, projectPath, provider]);

  useEffect(() => {
    if (activeRuntimeSessionId === undefined) {
      return;
    }
    setInteractiveSessionIdWithRef(activeRuntimeSessionId || null);
  }, [activeRuntimeSessionId, setInteractiveSessionIdWithRef]);

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
    if (event.provider_id && event.provider_id !== provider) {
      return;
    }
    if (activeRuntimeSessionId === null && !isPendingSendRef.current) {
      return;
    }
    if (
      event.session_id &&
      (activeRuntimeSessionId || interactiveSessionIdRef.current) &&
      event.session_id !== (activeRuntimeSessionId || interactiveSessionIdRef.current)
    ) {
      return;
    }
    if (event.state === "running") {
      hasActiveSessionRef.current = true;
      // Set interactiveSessionId from the event if available
      if (event.session_id) {
        setInteractiveSessionIdWithRef(event.session_id);
      }
      void syncProcessState();
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
    loadingStartedAt,
    setIsLoading,
    setIsPendingSend,
    setInteractiveSessionId: setInteractiveSessionIdWithRef,
    syncProcessState,
  };
}
