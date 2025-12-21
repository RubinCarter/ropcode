import { api, type MessageIndex } from '@/lib/api';
import type { ClaudeStreamMessage } from '@/components/AgentExecution';

/**
 * MessageWindowManager - Manages a sliding window of messages
 *
 * Design Philosophy (Linus-style):
 * - Don't copy all disk data to memory
 * - Three-layer architecture:
 *   1. Disk JSONL files (source of truth)
 *   2. Lightweight memory index (metadata only, ~120KB for 5000 messages)
 *   3. Sliding window cache (500 messages, ~1MB)
 *
 * Expected memory savings:
 * - Per session: 10MB → 1.12MB (89% reduction)
 * - 100 sessions: 1GB → 112MB
 */
export class MessageWindowManager {
  private runId: number;
  private index: MessageIndex[] = [];
  private window: Map<number, ClaudeStreamMessage> = new Map();
  private windowSize: number = 500;
  private preloadThreshold: number = 100;
  private initialized: boolean = false;

  constructor(runId: number, options?: { windowSize?: number; preloadThreshold?: number }) {
    this.runId = runId;
    if (options?.windowSize) this.windowSize = options.windowSize;
    if (options?.preloadThreshold) this.preloadThreshold = options.preloadThreshold;
  }

  /**
   * Initialize the manager by loading the message index
   * This loads metadata only, not the actual messages
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.index = await api.getSessionMessageIndex(this.runId);
      this.initialized = true;
      console.log(`MessageWindowManager initialized: ${this.index.length} messages indexed`);
    } catch (error) {
      console.error('Failed to initialize MessageWindowManager:', error);
      throw error;
    }
  }

  /**
   * Get the total number of messages
   */
  getTotalCount(): number {
    return this.index.length;
  }

  /**
   * Get messages for a visible range
   * Automatically manages the sliding window
   *
   * @param visibleRange - The range of messages currently visible
   * @returns Array of messages in the visible range
   */
  async getMessages(visibleRange: { start: number; end: number }): Promise<ClaudeStreamMessage[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Calculate the window range (visible range + preload buffer)
    const windowStart = Math.max(0, visibleRange.start - this.preloadThreshold);
    const windowEnd = Math.min(this.index.length, visibleRange.end + this.preloadThreshold);

    // Check if we need to load new messages
    const missingLines: number[] = [];
    for (let i = windowStart; i < windowEnd; i++) {
      if (!this.window.has(i)) {
        missingLines.push(i);
      }
    }

    // Load missing messages if any
    if (missingLines.length > 0) {
      await this.loadMessagesRange(Math.min(...missingLines), Math.max(...missingLines) + 1);
    }

    // Evict messages outside the window to save memory
    this.evictOutsideWindow(windowStart, windowEnd);

    // Return messages in the visible range
    const result: ClaudeStreamMessage[] = [];
    for (let i = visibleRange.start; i < Math.min(visibleRange.end, this.index.length); i++) {
      const message = this.window.get(i);
      if (message) {
        result.push(message);
      }
    }

    return result;
  }

  /**
   * Load a range of messages from the backend
   */
  private async loadMessagesRange(startLine: number, endLine: number): Promise<void> {
    try {
      const jsonlLines = await api.getSessionMessagesRange(this.runId, startLine, endLine);

      jsonlLines.forEach((line, idx) => {
        try {
          const message = JSON.parse(line) as ClaudeStreamMessage;
          this.window.set(startLine + idx, message);
        } catch (error) {
          console.error(`Failed to parse message at line ${startLine + idx}:`, error);
        }
      });
    } catch (error) {
      console.error(`Failed to load messages range [${startLine}, ${endLine}):`, error);
      throw error;
    }
  }

  /**
   * Evict messages outside the current window to save memory
   */
  private evictOutsideWindow(windowStart: number, windowEnd: number): void {
    const toEvict: number[] = [];

    for (const [lineNum] of this.window) {
      if (lineNum < windowStart || lineNum >= windowEnd) {
        toEvict.push(lineNum);
      }
    }

    // Only evict if we have more than windowSize messages
    if (this.window.size > this.windowSize) {
      toEvict.forEach(lineNum => this.window.delete(lineNum));
      if (toEvict.length > 0) {
        console.log(`Evicted ${toEvict.length} messages outside window [${windowStart}, ${windowEnd})`);
      }
    }
  }

  /**
   * Append a new message to the index and window
   * Used when receiving real-time messages
   */
  appendMessage(message: ClaudeStreamMessage): void {
    const lineNumber = this.index.length;

    // Add to index (with minimal metadata)
    this.index.push({
      line_number: lineNumber,
      byte_offset: 0, // Not needed for appended messages
      byte_length: 0,
      timestamp: (message as any).timestamp,
      message_type: (message as any).type,
    });

    // Add to window
    this.window.set(lineNumber, message);

    // Evict old messages if window is too large
    if (this.window.size > this.windowSize * 1.5) {
      const windowStart = Math.max(0, lineNumber - this.windowSize);
      this.evictOutsideWindow(windowStart, lineNumber + 1);
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.index = [];
    this.window.clear();
    this.initialized = false;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): { indexSize: number; windowSize: number; totalMessages: number } {
    // Rough estimate: each index entry is about 24 bytes
    const indexSize = this.index.length * 24;
    // Rough estimate: each message is about 2KB
    const windowSize = this.window.size * 2048;

    return {
      indexSize,
      windowSize,
      totalMessages: this.index.length,
    };
  }
}
