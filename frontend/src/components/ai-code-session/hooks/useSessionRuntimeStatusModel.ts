import { useEffect, useRef, useState } from "react";
import { deriveRuntimeViewState } from "../utils/runtimeState";
import { describeRuntimeStatus } from "../utils/runtimePresentation";
import {
  buildSessionStatusBarModel,
  type SessionStatusPromptConfig,
  type SessionThinkingStatus,
} from "../utils/sessionStatusBarPresentation";

interface UseSessionRuntimeStatusModelOptions {
  isLoading: boolean;
  interactiveSessionId: string | null;
  hasActiveProcess: boolean;
  transportConnected: boolean;
  isRecoveringHistory: boolean;
  isRestoringSession: boolean;
  stopRequested: boolean;
  lastTransportConnectAt: number | null;
  loadingStartedAt: number | null;
  frameRuntime: any;
  frameLastSeq: number;
  runtimeTracker: any;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedOutputTokens: number;
    totalTokens: number;
  };
  subagentProgress: any;
  currentTodoActiveForm: string | null | undefined;
  promptConfig: SessionStatusPromptConfig;
  queuedPromptsCount: number;
}

export function useSessionRuntimeStatusModel(options: UseSessionRuntimeStatusModelOptions) {
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const [thinkingStatus, setThinkingStatus] = useState<SessionThinkingStatus>(null);
  const thinkingStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!options.isLoading) return;
    setRuntimeNow(Date.now());
    const interval = setInterval(() => {
      setRuntimeNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [options.isLoading]);

  const runtimeViewState = deriveRuntimeViewState({
    tracker: options.runtimeTracker,
    local: {
      isLoading: options.isLoading,
      interactiveSessionId: options.interactiveSessionId,
      hasActiveProcess: options.hasActiveProcess,
      transportConnected: options.transportConnected,
      isRecoveringHistory: options.isRecoveringHistory,
      isRestoringSession: options.isRestoringSession,
      stopRequested: options.stopRequested,
      lastTransportConnectAt: options.lastTransportConnectAt,
      loadingStartedAt: options.loadingStartedAt,
      frameRuntime: options.frameRuntime,
      frameLastSeq: options.frameLastSeq,
    },
    now: runtimeNow,
  });
  const runtimeStatus = describeRuntimeStatus(runtimeViewState, runtimeNow);

  useEffect(() => {
    const phase = runtimeViewState.phase;

    if (phase === 'thinking') {
      if (thinkingStartedAtRef.current === null) {
        thinkingStartedAtRef.current = runtimeNow;
        setThinkingStatus({ state: 'active', startedAt: runtimeNow });
      }
      return;
    }

    if (
      (phase === 'reconnecting' || phase === 'recovering' || phase === 'rate_limited' || phase === 'retrying') &&
      thinkingStartedAtRef.current !== null
    ) {
      return;
    }

    if (thinkingStartedAtRef.current !== null) {
      const durationMs = Math.max(0, runtimeNow - thinkingStartedAtRef.current);
      thinkingStartedAtRef.current = null;
      setThinkingStatus({ state: 'completed', durationMs, completedAt: runtimeNow });
    }
  }, [runtimeNow, runtimeViewState.phase]);

  return buildSessionStatusBarModel({
    runtime: runtimeViewState,
    runtimeCopy: runtimeStatus,
    now: runtimeNow,
    loadingStartedAt: options.loadingStartedAt,
    tokenUsage: {
      ...options.tokenUsage,
      estimatedOutputTokens: Math.max(
        options.tokenUsage.estimatedOutputTokens,
        Math.round(options.runtimeTracker.lastPartialTextLength / 4)
      ),
    },
    subagentProgress: options.subagentProgress,
    currentTodoActiveForm: options.currentTodoActiveForm,
    promptConfig: options.promptConfig,
    isLoading: options.isLoading,
    interactiveSessionId: options.interactiveSessionId,
    stopVisible: options.stopRequested,
    queuedPromptsCount: options.queuedPromptsCount,
    thinkingStatus,
  });
}
