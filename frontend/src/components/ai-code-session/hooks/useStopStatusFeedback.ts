import { useCallback, useEffect, useRef, useState } from 'react';
import {
  STOP_STATUS_BUBBLE_DURATION_MS,
  getStopStatusBubbleState,
  shouldCompleteStopStatusBubble,
} from '../utils/stopStatusBubble';

interface UseStopStatusFeedbackOptions {
  isLoading: boolean;
  interactiveSessionId: string | null;
}

export interface UseStopStatusFeedbackReturn {
  stopRequestedRef: React.MutableRefObject<boolean>;
  stopStatusBubble: {
    visible: boolean;
    label: string | null;
  };
  showStopStatusBubble: () => void;
  completeStopStatusBubble: () => void;
}

export function useStopStatusFeedback({
  isLoading,
  interactiveSessionId,
}: UseStopStatusFeedbackOptions): UseStopStatusFeedbackReturn {
  const [stopStatusTick, setStopStatusTick] = useState(0);
  const [isStopFeedbackVisible, setIsStopFeedbackVisible] = useState(false);
  const stopRequestedRef = useRef(false);
  const stopCompletedAtRef = useRef<number | null>(null);
  const stopStatusHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStopStatusBubble = useCallback(() => {
    if (stopStatusHideTimerRef.current) {
      clearTimeout(stopStatusHideTimerRef.current);
      stopStatusHideTimerRef.current = null;
    }

    stopCompletedAtRef.current = null;
    setIsStopFeedbackVisible(true);
    setStopStatusTick(Date.now());
  }, []);

  const completeStopStatusBubble = useCallback(() => {
    stopCompletedAtRef.current = Date.now();
    setIsStopFeedbackVisible(false);
    setStopStatusTick(Date.now());

    if (stopStatusHideTimerRef.current) {
      clearTimeout(stopStatusHideTimerRef.current);
    }

    stopStatusHideTimerRef.current = setTimeout(() => {
      stopStatusHideTimerRef.current = null;
      setStopStatusTick(Date.now());
    }, STOP_STATUS_BUBBLE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (stopStatusHideTimerRef.current) {
        clearTimeout(stopStatusHideTimerRef.current);
      }
    };
  }, []);

  const stopStatusBubble = getStopStatusBubbleState({
    isStopping: isStopFeedbackVisible,
    lastCompletedAt: stopCompletedAtRef.current,
    now: stopStatusTick || Date.now(),
  });

  useEffect(() => {
    if (!shouldCompleteStopStatusBubble({
      stopRequested: stopRequestedRef.current,
      isLoading,
      interactiveSessionId,
    })) {
      return;
    }

    stopRequestedRef.current = false;
    completeStopStatusBubble();
  }, [completeStopStatusBubble, interactiveSessionId, isLoading]);

  return {
    stopRequestedRef,
    stopStatusBubble,
    showStopStatusBubble,
    completeStopStatusBubble,
  };
}
