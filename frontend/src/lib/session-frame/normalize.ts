import type { ContentBlock, SessionFrame, SessionFrameKind, SessionFrameRole } from './types';

const VALID_KINDS = new Set<SessionFrameKind>([
  'init',
  'message',
  'delta',
  'tool',
  'result',
  'error',
  'metadata',
]);

const VALID_ROLES = new Set<SessionFrameRole>(['assistant', 'user', 'system', 'tool']);

export function normalizeSessionFrame(input: unknown): SessionFrame {
  if (!isRecord(input)) {
    throw new Error('SessionFrame must be an object');
  }

  const streamId = requiredString(input, 'streamId');
  const frameId = requiredString(input, 'frameId');
  const provider = requiredString(input, 'provider');
  const runtimeSessionId = requiredString(input, 'runtimeSessionId');
  const kind = requiredKind(input.kind);
  const role = optionalRole(input.role);
  const content = normalizeContent(input.content);

  return {
    streamId,
    frameId,
    provider,
    runtimeSessionId,
    providerSessionId: optionalString(input.providerSessionId),
    cwd: optionalString(input.cwd),
    projectPath: optionalString(input.projectPath),
    seq: requiredNumber(input, 'seq'),
    timestamp: optionalString(input.timestamp),
    kind,
    role,
    subtype: optionalString(input.subtype),
    content,
    parentToolUseId: optionalString(input.parentToolUseId),
    taskId: optionalString(input.taskId),
    toolUseId: optionalString(input.toolUseId),
    agentId: optionalString(input.agentId),
    sidechain: optionalBoolean(input.sidechain),
    success: optionalBoolean(input.success),
    error: optionalString(input.error),
    isError: optionalBoolean(input.isError),
    durationMs: optionalNumber(input.durationMs),
    result: optionalString(input.result),
    usage: isRecord(input.usage) ? { ...input.usage } : undefined,
    runtime: isRecord(input.runtime) ? { ...input.runtime } : undefined,
    meta: isRecord(input.meta) ? { ...input.meta } : undefined,
  };
}

function normalizeContent(value: unknown): ContentBlock[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('SessionFrame content must be an array');
  }

  return value.map((block) => {
    if (!isRecord(block)) {
      throw new Error('SessionFrame content block must be an object');
    }
    const type = requiredString(block, 'type');
    switch (type) {
      case 'text':
      case 'thinking':
        return { ...block, type, text: requiredString(block, 'text') } as ContentBlock;
      case 'tool_use':
        return {
          ...block,
          type,
          toolUseId: requiredString(block, 'toolUseId'),
          name: requiredString(block, 'name'),
        } as ContentBlock;
      case 'tool_result':
        return { ...block, type, toolUseId: requiredString(block, 'toolUseId') } as ContentBlock;
      case 'system':
      case 'result':
      case 'error':
        return { ...block, type } as ContentBlock;
      default:
        throw new Error(`Unknown SessionFrame content type: ${type}`);
    }
  });
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SessionFrame ${key} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`SessionFrame ${key} must be a finite number`);
  }
  return value;
}

function requiredKind(value: unknown): SessionFrameKind {
  if (typeof value !== 'string' || !VALID_KINDS.has(value as SessionFrameKind)) {
    throw new Error('SessionFrame kind is invalid');
  }
  return value as SessionFrameKind;
}

function optionalRole(value: unknown): SessionFrameRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !VALID_ROLES.has(value as SessionFrameRole)) {
    throw new Error('SessionFrame role is invalid');
  }
  return value as SessionFrameRole;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
