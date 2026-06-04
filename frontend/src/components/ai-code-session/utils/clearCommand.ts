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
