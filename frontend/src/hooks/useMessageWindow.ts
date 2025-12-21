import { useState, useCallback, useRef, useEffect } from 'react';
import { MessageWindowManager } from '@/services/MessageWindowManager';
import type { ClaudeStreamMessage } from '@/components/AgentExecution';

interface UseMessageWindowOptions {
  runId: number;
  enabled?: boolean;
  windowSize?: number;
  preloadThreshold?: number;
}

interface VisibleRange {
  start: number;
  end: number;
}

/**
 * React Hook for managing a sliding window of messages
 *
 * Usage:
 * ```tsx
 * const { messages, totalCount, updateVisibleRange, appendMessage, isLoading } =
 *   useMessageWindow({ runId: 123 });
 *
 * // In virtual scroller
 * useEffect(() => {
 *   updateVisibleRange({ start: virtualizer.range.startIndex, end: virtualizer.range.endIndex });
 * }, [virtualizer.range]);
 * ```
 */
export function useMessageWindow(options: UseMessageWindowOptions) {
  const { runId, enabled = true, windowSize, preloadThreshold } = options;

  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const managerRef = useRef<MessageWindowManager | null>(null);
  const visibleRangeRef = useRef<VisibleRange>({ start: 0, end: 0 });
  const loadingRef = useRef<boolean>(false);

  // Initialize manager
  useEffect(() => {
    if (!enabled) return;

    const manager = new MessageWindowManager(runId, { windowSize, preloadThreshold });
    managerRef.current = manager;

    const initializeManager = async () => {
      setIsLoading(true);
      setError(null);
      try {
        await manager.initialize();
        setTotalCount(manager.getTotalCount());

        // Load initial messages (last 500 messages)
        const total = manager.getTotalCount();
        const initialStart = Math.max(0, total - 500);
        const initialEnd = total;

        visibleRangeRef.current = { start: initialStart, end: initialEnd };
        const initialMessages = await manager.getMessages({ start: initialStart, end: initialEnd });
        setMessages(initialMessages);
      } catch (err) {
        console.error('Failed to initialize message window:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize'));
      } finally {
        setIsLoading(false);
      }
    };

    initializeManager();

    return () => {
      manager.clear();
      managerRef.current = null;
    };
  }, [runId, enabled, windowSize, preloadThreshold]);

  /**
   * Update the visible range and load messages as needed
   */
  const updateVisibleRange = useCallback(async (range: VisibleRange) => {
    const manager = managerRef.current;
    if (!manager || loadingRef.current) return;

    visibleRangeRef.current = range;
    loadingRef.current = true;

    try {
      const newMessages = await manager.getMessages(range);
      setMessages(newMessages);
    } catch (err) {
      console.error('Failed to update visible range:', err);
      setError(err instanceof Error ? err : new Error('Failed to update range'));
    } finally {
      loadingRef.current = false;
    }
  }, []);

  /**
   * Append a new message (for real-time updates)
   */
  const appendMessage = useCallback((message: ClaudeStreamMessage) => {
    const manager = managerRef.current;
    if (!manager) return;

    manager.appendMessage(message);
    setTotalCount(manager.getTotalCount());

    // If the new message is in the visible range, add it to messages
    const newIndex = manager.getTotalCount() - 1;
    const range = visibleRangeRef.current;

    if (newIndex >= range.start && newIndex < range.end) {
      setMessages(prev => [...prev, message]);
    }
  }, []);

  /**
   * Manually trigger a refresh of the current visible range
   */
  const refresh = useCallback(async () => {
    await updateVisibleRange(visibleRangeRef.current);
  }, [updateVisibleRange]);

  /**
   * Get memory usage statistics
   */
  const getMemoryStats = useCallback(() => {
    return managerRef.current?.getMemoryStats() || null;
  }, []);

  return {
    messages,
    totalCount,
    isLoading,
    error,
    updateVisibleRange,
    appendMessage,
    refresh,
    getMemoryStats,
  };
}
