export const DEFAULT_SESSION_PROVIDER = 'claude';

export function resolveSessionProvider(...candidates: Array<string | null | undefined>): string {
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? DEFAULT_SESSION_PROVIDER;
}

