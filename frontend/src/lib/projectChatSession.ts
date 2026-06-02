import type { SwitchResult } from './rpc-client';

export interface ProjectChatSessionSeed {
  id?: string;
  session_id?: string;
  provider_session_id?: string;
  provider?: string;
  model?: string;
}

export interface ProjectChatSegmentSeed {
  id: string;
  provider: string;
  model: string;
  runtimeSessionId: string;
  streamId: string;
  seq: number;
}

export function projectChatExistingSessionId(
  session?: ProjectChatSessionSeed | null,
  fallbackSessionId?: string | null,
): string {
  return firstNonEmpty(
    session?.provider_session_id,
    session?.session_id,
    session?.id,
    fallbackSessionId,
  );
}

export function projectChatSegmentFromSwitchResult(
  result: SwitchResult,
  provider: string,
  model: string,
  seq: number,
): ProjectChatSegmentSeed {
  return {
    id: result.segment_id || result.chat_id,
    provider: result.provider || provider,
    model: result.model || model,
    runtimeSessionId: result.runtime_session_id || '',
    streamId: result.stream_id || result.chat_id,
    seq,
  };
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}
