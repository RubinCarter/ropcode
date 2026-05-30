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

export function shouldCreateFreshProviderSession(prompt: string, provider?: string): boolean {
	return isExactClearCommand(prompt) && Boolean(provider);
}

export function shouldStopProviderSessionImmediately(_prompt: string, _provider?: string): boolean {
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
  return Boolean(provider) && (isLoading || interactiveSessionId != null);
}

export function getLocalClearMessage({ provider, didStopSession }: LocalClearMessageInput): string {
  if (didStopSession) {
    return `Conversation cleared. ${provider ?? 'Provider'} session stopped; the next message will start fresh.`;
  }

  return `Conversation cleared. The next message will start a fresh ${provider ?? 'provider'} session.`;
}
