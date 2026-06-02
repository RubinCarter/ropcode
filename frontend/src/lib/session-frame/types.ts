export type SessionFrameKind =
  | 'init'
  | 'message'
  | 'delta'
  | 'tool'
  | 'result'
  | 'error'
  | 'metadata';

export type SessionFrameRole = 'assistant' | 'user' | 'system' | 'tool';

export type SessionFrameOperation = 'append' | 'upsert';

export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | SystemContentBlock
  | ResultContentBlock
  | ErrorContentBlock;

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ThinkingContentBlock {
  type: 'thinking';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  toolUseId: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  toolUseId: string;
  text?: string;
  output?: unknown;
  isError?: boolean;
}

export interface SystemContentBlock {
  type: 'system';
  text?: string;
}

export interface ResultContentBlock {
  type: 'result';
  text?: string;
}

export interface ErrorContentBlock {
  type: 'error';
  text?: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  toolUseCount?: number;
}

export interface RuntimeSnapshot {
  phase?: string;
  activeTool?: string;
  progressText?: string;
  retry?: RetrySnapshot;
  rateLimit?: RateLimit;
  waitingOn?: string;
}

export interface RetrySnapshot {
  attempt?: number;
  maxAttempts?: number;
  nextRetryMs?: number;
}

export interface RateLimit {
  resetAt?: string;
  remainingMs?: number;
}

export interface SessionFrameMeta {
  raw?: Record<string, unknown>;
}

export interface SessionFrame {
  streamId: string;
  frameId: string;
  messageId?: string;
  operation?: SessionFrameOperation;
  provider: string;
  runtimeSessionId: string;
  providerSessionId?: string;
  cwd?: string;
  projectPath?: string;
  seq: number;
  timestamp?: string;
  kind: SessionFrameKind;
  role?: SessionFrameRole;
  subtype?: string;
  content: ContentBlock[];
  parentToolUseId?: string;
  taskId?: string;
  toolUseId?: string;
  agentId?: string;
  sidechain?: boolean;
  success?: boolean;
  error?: string;
  isError?: boolean;
  durationMs?: number;
  result?: string;
  usage?: Usage;
  runtime?: RuntimeSnapshot;
  meta?: SessionFrameMeta;
}
