/**
 * AI Code Session - Main exports
 *
 * This is the refactored version of ClaudeCodeSession with improved architecture:
 * - Hooks-based state management
 * - Clear separation of concerns
 * - Better maintainability
 */

export { AiCodeSession } from './AiCodeSession';
export type { AiCodeSessionProps } from './types';

// Export hooks for testing and advanced usage
export {
  useSessionState,
  useMessages,
  useProcessState,
  usePromptQueue,
  useSessionMetrics,
  useSessionEvents,
} from './hooks';

// Export types
export type {
  SessionInfo,
  QueuedPrompt,
  SessionMetrics,
  ClaudeStreamMessage,
} from './types';
