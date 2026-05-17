/**
 * Prompt queue management hook
 *
 * Manages queued prompts including:
 * - Queue state
 * - Queue UI collapse state
 * - Auto-processing via explicit processNextInQueue() call
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { QueuedPrompt } from "../types";

export interface UsePromptQueueOptions {
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
  addToQueue: (prompt: string, model: string, providerApiId?: string | null, thinkingMode?: string, provider?: string) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  processNextInQueue: () => void;

  // Refs
  queuedPromptsRef: React.MutableRefObject<QueuedPrompt[]>;
}

/**
 * Hook to manage prompt queue
 */
export function usePromptQueue(options: UsePromptQueueOptions): UsePromptQueueReturn {
  const { onProcessNext } = options;

  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [queuedPromptsCollapsed, setQueuedPromptsCollapsed] = useState(false);

  // Ref for stable access in callbacks
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  // Stable ref for onProcessNext callback
  const onProcessNextRef = useRef(onProcessNext);

  // Keep refs in sync
  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
  }, [queuedPrompts]);

  useEffect(() => {
    onProcessNextRef.current = onProcessNext;
  }, [onProcessNext]);

  // Process the next queued prompt — called explicitly when session becomes idle
  const processNextInQueue = useCallback(() => {
    if (queuedPromptsRef.current.length === 0) {
      return;
    }

    const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
    console.log('[usePromptQueue] Processing next queued prompt:', {
      prompt: nextPrompt.prompt.substring(0, 50) + '...',
      model: nextPrompt.model,
      remainingCount: remainingPrompts.length,
    });

    queuedPromptsRef.current = remainingPrompts;  // sync ref immediately
    setQueuedPrompts(remainingPrompts);

    // Small delay to ensure UI updates before sending
    setTimeout(() => {
      onProcessNextRef.current?.(nextPrompt);
    }, 100);
  }, [setQueuedPrompts]);

  // Helper functions
  const addToQueue = (prompt: string, model: string, providerApiId?: string | null, thinkingMode?: string, provider?: string) => {
    const newPrompt: QueuedPrompt = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      model,
      providerApiId,
      thinkingMode,
      provider,
    };
    setQueuedPrompts(prev => {
      const updated = [...prev, newPrompt];
      queuedPromptsRef.current = updated;  // sync ref immediately
      return updated;
    });
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
    processNextInQueue,
    queuedPromptsRef,
  };
}
