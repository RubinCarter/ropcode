/**
 * Prompt queue management hook
 *
 * Manages queued prompts including:
 * - Queue state
 * - Queue UI collapse state
 * - Auto-processing when session becomes idle
 */

import { useState, useEffect, useRef } from "react";
import type { QueuedPrompt } from "../types";
import { api } from "@/lib/api";

export interface UsePromptQueueOptions {
  isLoading: boolean;
  isPendingSend: boolean;
  projectPath: string;
  onProcessNext?: (prompt: QueuedPrompt) => void;
}

export interface UsePromptQueueReturn {
  // State
  queuedPrompts: QueuedPrompt[];
  queuedPromptsCollapsed: boolean;

  // Setters
  setQueuedPrompts: React.Dispatch<React.SetStateAction<QueuedPrompt[]>>;
  setQueuedPromptsCollapsed: (collapsed: boolean) => void;

  // Actions
  addToQueue: (prompt: string, model: string) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;

  // Refs
  queuedPromptsRef: React.MutableRefObject<QueuedPrompt[]>;
}

/**
 * Hook to manage prompt queue
 */
export function usePromptQueue(options: UsePromptQueueOptions): UsePromptQueueReturn {
  const { isLoading, isPendingSend, projectPath, onProcessNext } = options;

  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [queuedPromptsCollapsed, setQueuedPromptsCollapsed] = useState(false);

  // Ref for stable access in callbacks
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  // Track previous loading state with ref to avoid stale closures
  const wasLoadingRef = useRef(false);
  // Prevent duplicate processing with a flag
  const isProcessingRef = useRef(false);
  // Stable ref for onProcessNext callback
  const onProcessNextRef = useRef(onProcessNext);

  // Keep refs in sync
  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  useEffect(() => {
    onProcessNextRef.current = onProcessNext;
  }, [onProcessNext]);

  // Auto-process queued prompts when session becomes idle
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;

    // Update wasLoadingRef for next render
    wasLoadingRef.current = isLoading;

    // Only process when was loading and now is not loading (session completed/stopped)
    // Also check isProcessingRef to prevent duplicate processing
    if (wasLoading && !isLoading && queuedPromptsRef.current.length > 0 && projectPath && !isPendingSend && !isProcessingRef.current) {
      console.log('[usePromptQueue] Session became idle, checking queue:', {
        queuedCount: queuedPromptsRef.current.length,
        projectPath
      });

      // Set processing flag to prevent duplicates
      isProcessingRef.current = true;

      const processQueuedPrompts = async () => {
        try {
          // Double-check with backend that session is actually not running
          const running = await api.isClaudeSessionRunningForProject(projectPath);
          console.log('[usePromptQueue] Backend running state:', running);

          if (!running && queuedPromptsRef.current.length > 0) {
            const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
            console.log('[usePromptQueue] Processing next queued prompt:', {
              prompt: nextPrompt.prompt.substring(0, 50) + '...',
              model: nextPrompt.model,
              remainingCount: remainingPrompts.length
            });

            setQueuedPrompts(remainingPrompts);

            // Small delay to ensure UI updates
            setTimeout(() => {
              onProcessNextRef.current?.(nextPrompt);
              // Reset processing flag after callback is invoked
              isProcessingRef.current = false;
            }, 100);
          } else {
            // Reset processing flag if we didn't process anything
            isProcessingRef.current = false;
          }
        } catch (err) {
          console.error('[usePromptQueue] Failed to check backend state:', err);
          // Reset processing flag on error
          isProcessingRef.current = false;
        }
      };

      processQueuedPrompts();
    }
  }, [isLoading, projectPath, isPendingSend]);  // Removed wasLoading and onProcessNext from deps

  // Helper functions
  const addToQueue = (prompt: string, model: string) => {
    const newPrompt: QueuedPrompt = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      model
    };
    setQueuedPrompts(prev => [...prev, newPrompt]);
    console.log('[usePromptQueue] Added prompt to queue:', newPrompt.id);
  };

  const removeFromQueue = (id: string) => {
    setQueuedPrompts(prev => prev.filter(p => p.id !== id));
    console.log('[usePromptQueue] Removed prompt from queue:', id);
  };

  const clearQueue = () => {
    setQueuedPrompts([]);
    console.log('[usePromptQueue] Cleared queue');
  };

  return {
    queuedPrompts,
    queuedPromptsCollapsed,
    setQueuedPrompts,
    setQueuedPromptsCollapsed,
    addToQueue,
    removeFromQueue,
    clearQueue,
    queuedPromptsRef,
  };
}
