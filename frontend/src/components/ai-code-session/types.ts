/**
 * Type definitions for AI Code Session component
 *
 * Extracted from ClaudeCodeSession.tsx to improve code organization
 */

import type { Session } from "@/lib/api";
import type { ClaudeStreamMessage } from "../AgentExecution";

/**
 * Props for the AI Code Session component
 */
export interface AiCodeSessionProps {
  /**
   * Optional session to resume (when clicking from SessionList)
   */
  session?: Session;
  /**
   * Initial project path (for new sessions)
   */
  initialProjectPath?: string;
  /**
   * Callback to go back
   */
  onBack: () => void;
  /**
   * Callback to open hooks configuration
   */
  onProjectSettings?: (projectPath: string) => void;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when streaming state changes
   */
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
  /**
   * Callback when project path changes
   */
  onProjectPathChange?: (path: string) => void;
  /**
   * Default provider ID (e.g., "claude", "codex")
   */
  defaultProvider?: string;
  /**
   * Callback when provider changes
   */
  onProviderChange?: (providerId: string) => void;
}

/**
 * Session information extracted from init messages
 */
export interface SessionInfo {
  sessionId: string;
  projectId: string;
}

/**
 * Queued prompt structure
 */
export interface QueuedPrompt {
  id: string;
  prompt: string;
  model: string;
}

/**
 * Session metrics for analytics
 */
export interface SessionMetrics {
  firstMessageTime: number | null;
  promptsSent: number;
  toolsExecuted: number;
  toolsFailed: number;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  codeBlocksGenerated: number;
  errorsEncountered: number;
  lastActivityTime: number;
  toolExecutionTimes: number[];
  wasResumed: boolean;
  modelChanges: Array<{ from: string; to: string; timestamp: number }>;
}

/**
 * Re-export commonly used types
 */
export type { Session, ClaudeStreamMessage };
