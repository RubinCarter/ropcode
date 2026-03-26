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
