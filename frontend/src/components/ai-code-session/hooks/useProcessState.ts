/**
 * Process state synchronization hook
 *
 * Manages process execution state including:
 * - Loading/execution state
 * - Pending send state
 * - Process state polling
 * - State synchronization with backend
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

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

  // Setters
  setIsLoading: (loading: boolean) => void;
  setIsPendingSend: (pending: boolean) => void;

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

  // Refs for stable access
  const hasActiveSessionRef = useRef(false);
  const isPendingSendRef = useRef(isPendingSend);
  isPendingSendRef.current = isPendingSend;

  /**
   * Sync process state with backend
   * Queries actual process state from ProcessRegistry
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
      setIsLoading(running);
      hasActiveSessionRef.current = running;
    } catch {
      // Keep current state on error
    }
  }, [projectPath, provider]);

  // Sync on mount and when project path changes
  useEffect(() => {
    syncProcessState();
  }, [syncProcessState]);

  // Fallback polling when isLoading is true (every 200ms)
  useEffect(() => {
    // Don't poll if pending send or not loading
    if (!isLoading || !projectPath || isPendingSend) return;

    const interval = setInterval(() => {
      syncProcessState();
    }, 200); // Check every 200ms

    return () => clearInterval(interval);
  }, [isLoading, projectPath, isPendingSend, syncProcessState]);

  return {
    isLoading,
    isPendingSend,
    hasActiveSessionRef,
    isPendingSendRef,
    setIsLoading,
    setIsPendingSend,
    syncProcessState,
  };
}
