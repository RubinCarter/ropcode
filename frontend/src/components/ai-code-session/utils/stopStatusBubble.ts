export const STOP_STATUS_BUBBLE_DURATION_MS = 1500;

export interface StopStatusBubbleStateInput {
  isStopping: boolean;
  lastCompletedAt: number | null;
  now: number;
}

export interface StopStatusBubbleState {
  visible: boolean;
  label: 'Stopping' | null;
}

export interface StopStatusBubbleCompletionInput {
  stopRequested: boolean;
  isLoading: boolean;
  interactiveSessionId: string | null;
}

export function getStopStatusBubbleState({
  isStopping,
  lastCompletedAt,
  now,
}: StopStatusBubbleStateInput): StopStatusBubbleState {
  if (isStopping) {
    return { visible: true, label: 'Stopping' };
  }

  if (lastCompletedAt !== null && now - lastCompletedAt <= STOP_STATUS_BUBBLE_DURATION_MS) {
    return { visible: true, label: 'Stopping' };
  }

  return { visible: false, label: null };
}

export function shouldCompleteStopStatusBubble({
  stopRequested,
  isLoading,
  interactiveSessionId,
}: StopStatusBubbleCompletionInput): boolean {
  return stopRequested && !isLoading && interactiveSessionId === null;
}

export function getStopStatusControlLayoutClassName(): string {
  return 'flex flex-col items-center gap-1.5';
}
