/**
 * Title / branch generation orchestrator.
 *
 * Backend `Generate*Async` RPCs return a `request_id` immediately and emit a
 * `session-title:generated` / `branch-name:generated` event when the
 * underlying CLI / API call finishes. This module subscribes to those events
 * once per page and converts them into Promises keyed by request_id so callers
 * can `await` the result without holding an RPC open for up to 60 seconds.
 *
 * Why this matters: the synchronous `Generate*` RPCs share the WebSocket Send
 * channel with high-frequency `claude-output` / `pty-output` events. Holding
 * the RPC open during CLI-spawn-based title generation starves regular button
 * RPC responses, which is what made the UI feel frozen during the first
 * message of a chat. Async + event delivery decouples the two completely.
 */
import { useCallback, useState } from 'react';
import { EventsOn } from '@/lib/rpc-events';
import {
  GenerateSessionTitleAsync,
  GenerateSessionTitleForSessionAsync,
  GenerateBranchNameAsync,
} from '@/lib/rpc-client';

interface SessionTitlePayload {
  request_id: string;
  kind: 'first-prompt' | 'session';
  title?: string;
  error?: string;
  provider?: string;
  session_id?: string;
  project_id?: string;
}

interface BranchNamePayload {
  request_id: string;
  project_path?: string;
  branch?: string;
  error?: string;
}

type TitleResolver = (payload: SessionTitlePayload) => void;
type BranchResolver = (payload: BranchNamePayload) => void;

const titleResolvers = new Map<string, TitleResolver>();
const branchResolvers = new Map<string, BranchResolver>();

let listenersInstalled = false;

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  EventsOn('session-title:generated', (payload: SessionTitlePayload) => {
    const requestId = payload?.request_id;
    if (!requestId) return;
    const resolver = titleResolvers.get(requestId);
    if (!resolver) return;
    titleResolvers.delete(requestId);
    resolver(payload);
  });

  EventsOn('branch-name:generated', (payload: BranchNamePayload) => {
    const requestId = payload?.request_id;
    if (!requestId) return;
    const resolver = branchResolvers.get(requestId);
    if (!resolver) return;
    branchResolvers.delete(requestId);
    resolver(payload);
  });
}

/**
 * Wait at most `timeoutMs` for the matching result event before rejecting.
 * Generation that times out client-side is still considered finished server-
 * side; the resolver is removed so a late event is silently ignored.
 */
function awaitResult<T extends { error?: string }>(
  registry: Map<string, (payload: T) => void>,
  requestId: string,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      registry.delete(requestId);
      reject(new Error('Title generation timed out'));
    }, timeoutMs);

    registry.set(requestId, (payload) => {
      clearTimeout(timeoutId);
      if (payload?.error) {
        reject(new Error(payload.error));
        return;
      }
      resolve(payload);
    });
  });
}

const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Kick off async title generation for a brand-new session and resolve with the
 * generated title (already cleaned by the backend). Empty titles surface as ''.
 */
export async function generateSessionTitleViaEvent(prompt: string): Promise<string> {
  ensureListeners();
  const requestId = await GenerateSessionTitleAsync(prompt);
  const result = await awaitResult<SessionTitlePayload>(titleResolvers, requestId, DEFAULT_TIMEOUT_MS);
  return (result.title ?? '').trim();
}

/**
 * Regenerate the title for an existing session in the background.
 */
export async function generateSessionTitleForSessionViaEvent(
  provider: string,
  sessionId: string,
  projectId: string,
): Promise<string> {
  ensureListeners();
  const requestId = await GenerateSessionTitleForSessionAsync(provider, sessionId, projectId);
  const result = await awaitResult<SessionTitlePayload>(titleResolvers, requestId, DEFAULT_TIMEOUT_MS);
  return (result.title ?? '').trim();
}

/**
 * Kick off branch-name generation for a workspace and resolve with the slug.
 */
export async function generateBranchNameViaEvent(projectPath: string): Promise<string> {
  ensureListeners();
  const requestId = await GenerateBranchNameAsync(projectPath);
  const result = await awaitResult<BranchNamePayload>(branchResolvers, requestId, DEFAULT_TIMEOUT_MS);
  return (result.branch ?? '').trim();
}

/**
 * Convenience hook for buttons that need an in-flight indicator. Tracks a
 * single in-flight generation per hook instance.
 */
export function useTitleGenerationFlag() {
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setPending(true);
    try {
      return await work();
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, run };
}
