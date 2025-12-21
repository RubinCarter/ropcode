/**
 * Session metrics tracking hook
 *
 * Manages session analytics metrics including:
 * - Timing metrics (first message, response time, idle time)
 * - Interaction metrics (prompts, tools, files)
 * - Content metrics (tokens, code blocks, errors)
 */

import { useRef } from "react";
import type { SessionMetrics } from "../types";

export interface UseSessionMetricsOptions {
  wasResumed: boolean;
}

export interface UseSessionMetricsReturn {
  sessionMetrics: React.MutableRefObject<SessionMetrics>;
  sessionStartTime: React.MutableRefObject<number>;

  // Metric updaters
  trackPromptSent: (model: string) => void;
  trackToolExecution: (toolName: string) => void;
  trackToolFailure: () => void;
  trackFileOperation: (operation: 'create' | 'modify' | 'delete') => void;
  trackCodeBlock: () => void;
  trackError: () => void;
  trackModelChange: (from: string, to: string) => void;
  resetMetrics: () => void;
}

/**
 * Hook to manage session metrics
 */
export function useSessionMetrics(options: UseSessionMetricsOptions): UseSessionMetricsReturn {
  const { wasResumed } = options;

  const sessionStartTime = useRef<number>(Date.now());

  const sessionMetrics = useRef<SessionMetrics>({
    firstMessageTime: null,
    promptsSent: 0,
    toolsExecuted: 0,
    toolsFailed: 0,
    filesCreated: 0,
    filesModified: 0,
    filesDeleted: 0,
    codeBlocksGenerated: 0,
    errorsEncountered: 0,
    lastActivityTime: Date.now(),
    toolExecutionTimes: [],
    wasResumed,
    modelChanges: [],
  });

  // Metric updaters
  const trackPromptSent = (model: string) => {
    const metrics = sessionMetrics.current;
    metrics.promptsSent += 1;
    metrics.lastActivityTime = Date.now();

    if (!metrics.firstMessageTime) {
      metrics.firstMessageTime = Date.now();
    }

    // Track model changes
    const lastModel = metrics.modelChanges.length > 0
      ? metrics.modelChanges[metrics.modelChanges.length - 1].to
      : (wasResumed ? 'sonnet' : model);

    if (lastModel !== model) {
      metrics.modelChanges.push({
        from: lastModel,
        to: model,
        timestamp: Date.now()
      });
    }
  };

  const trackToolExecution = (_toolName: string) => {
    const metrics = sessionMetrics.current;
    metrics.toolsExecuted += 1;
    metrics.lastActivityTime = Date.now();
  };

  const trackToolFailure = () => {
    const metrics = sessionMetrics.current;
    metrics.toolsFailed += 1;
    metrics.errorsEncountered += 1;
  };

  const trackFileOperation = (operation: 'create' | 'modify' | 'delete') => {
    const metrics = sessionMetrics.current;
    if (operation === 'create') {
      metrics.filesCreated += 1;
    } else if (operation === 'modify') {
      metrics.filesModified += 1;
    } else if (operation === 'delete') {
      metrics.filesDeleted += 1;
    }
  };

  const trackCodeBlock = () => {
    const metrics = sessionMetrics.current;
    metrics.codeBlocksGenerated += 1;
  };

  const trackError = () => {
    const metrics = sessionMetrics.current;
    metrics.errorsEncountered += 1;
  };

  const trackModelChange = (from: string, to: string) => {
    const metrics = sessionMetrics.current;
    metrics.modelChanges.push({
      from,
      to,
      timestamp: Date.now()
    });
  };

  const resetMetrics = () => {
    sessionMetrics.current = {
      firstMessageTime: null,
      promptsSent: 0,
      toolsExecuted: 0,
      toolsFailed: 0,
      filesCreated: 0,
      filesModified: 0,
      filesDeleted: 0,
      codeBlocksGenerated: 0,
      errorsEncountered: 0,
      lastActivityTime: Date.now(),
      toolExecutionTimes: [],
      wasResumed: false,
      modelChanges: [],
    };
    sessionStartTime.current = Date.now();
  };

  return {
    sessionMetrics,
    sessionStartTime,
    trackPromptSent,
    trackToolExecution,
    trackToolFailure,
    trackFileOperation,
    trackCodeBlock,
    trackError,
    trackModelChange,
    resetMetrics,
  };
}
