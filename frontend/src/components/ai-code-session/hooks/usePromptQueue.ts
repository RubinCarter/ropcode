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
  const [wasLoading, setWasLoading] = useState(false);

  // Ref for stable access in callbacks
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);

  // Keep ref in sync
  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  // Track previous loading state
  useEffect(() => {
    setWasLoading(isLoading);
  }, [isLoading]);

  // Auto-process queued prompts when session becomes idle
  useEffect(() => {
    // Only process when was loading and now is not loading (session completed/stopped)
    if (wasLoading && !isLoading && queuedPromptsRef.current.length > 0 && projectPath && !isPendingSend) {
      console.log('[usePromptQueue] Session became idle, checking queue:', {
        queuedCount: queuedPromptsRef.current.length,
        projectPath
      });

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
              onProcessNext?.(nextPrompt);
            }, 100);
          }
        } catch (err) {
          console.error('[usePromptQueue] Failed to check backend state:', err);
        }
      };

      processQueuedPrompts();
    }
  }, [isLoading, wasLoading, projectPath, isPendingSend, onProcessNext]);

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
