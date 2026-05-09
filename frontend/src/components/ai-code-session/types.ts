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
  runtimeSessionId?: string;
  claudeSessionId?: string;
}

/**
 * Queued prompt structure
 */
export interface QueuedPrompt {
  id: string;
  prompt: string;
  model: string;
  providerApiId?: string | null;
  thinkingMode?: string;
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

export interface ClaudeToolProgress {
  tool_name?: string;
  step?: number;
  total_steps?: number;
  percent?: number;
  description?: string;
}

export interface ClaudeApiRetryInfo {
  reason?: string;
  attempt?: number;
  max_attempts?: number;
  retry_after_ms?: number;
  error_status?: number;
}

export interface ClaudeRuntimeStateSnapshot {
  processing: boolean;
  retrying: boolean;
  rate_limited: boolean;
  active_tool?: string;
  active_tool_progress?: ClaudeToolProgress | null;
  last_api_retry?: ClaudeApiRetryInfo | null;
  last_thinking_phase?: string;
  last_partial_text_length?: number;
  last_event_type?: string;
  last_event_subtype?: string;
}

export interface ClaudeDebugMeta {
  runtime_state?: ClaudeRuntimeStateSnapshot | null;
}

export interface SessionRuntimeTracker {
  snapshot: ClaudeRuntimeStateSnapshot | null;
  systemInitReceived: boolean;
  lastUpdatedAt: number | null;
  lastEventAt: number | null;
  lastEventType: string | null;
  lastEventSubtype: string | null;
  lastTextGrowthAt: number | null;
  lastPartialTextLength: number;
  lastToolChangeAt: number | null;
  lastToolResultAt: number | null;
  lastResultAt: number | null;
  lastErrorAt: number | null;
}

export type SessionRuntimePhase =
  | 'idle'
  | 'initializing'
  | 'recovering'
  | 'reconnecting'
  | 'thinking'
  | 'tool_running'
  | 'retrying'
  | 'rate_limited'
  | 'compacting'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SessionRuntimeSeverity = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export type SessionRuntimeWaitingReason =
  | 'init'
  | 'tool'
  | 'retry'
  | 'rate_limit'
  | 'reconnect'
  | 'recovery'
  | 'model'
  | 'result'
  | 'idle'
  | null;

export interface SessionRuntimeRetryState {
  attempt: number;
  maxAttempts: number;
  retryAfterMs: number;
  reason?: string;
}

export interface SessionRuntimeViewState {
  phase: SessionRuntimePhase;
  label: string;
  detail: string | null;
  severity: SessionRuntimeSeverity;
  activeTool: string | null;
  toolProgressText: string | null;
  retry: SessionRuntimeRetryState | null;
  rateLimited: boolean;
  transportState: 'connected' | 'reconnecting';
  waitingReason: SessionRuntimeWaitingReason;
  isStuckLikely: boolean;
  lastUpdatedAt: number | null;
}

/**
 * Re-export commonly used types
 */
export type { Session, ClaudeStreamMessage };
