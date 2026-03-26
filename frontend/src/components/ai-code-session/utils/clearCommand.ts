export interface LocalClearStopFeedbackInput {
  provider?: string;
  isLoading: boolean;
  interactiveSessionId?: string | null;
}

export interface LocalClearMessageInput {
  provider?: string;
  didStopSession: boolean;
}

export function isExactClearCommand(prompt: string): boolean {
  return prompt.trim() === '/clear';
}

export function shouldCreateFreshClaudeSession(prompt: string, provider?: string): boolean {
  return isExactClearCommand(prompt) && provider === 'claude';
}

export function shouldStopClaudeSessionImmediately(_prompt: string, _provider?: string): boolean {
  return false;
}

export function shouldForwardClearToProvider(_prompt: string, _provider?: string): boolean {
  return false;
}

export function shouldUseLocalClearFallback(prompt: string, _provider?: string): boolean {
  return isExactClearCommand(prompt);
}

export function shouldShowStopFeedbackOnLocalClear({
  provider,
  isLoading,
  interactiveSessionId,
}: LocalClearStopFeedbackInput): boolean {
  return provider === 'claude' && (isLoading || interactiveSessionId != null);
}

export function getLocalClearMessage({ provider, didStopSession }: LocalClearMessageInput): string {
  if (provider !== 'claude') {
    return 'Local conversation view cleared. Provider session was not reset.';
  }

  if (didStopSession) {
    return 'Conversation cleared. Claude session stopped; the next message will start fresh.';
  }

  return 'Conversation cleared. The next message will start a fresh Claude session.';
}
