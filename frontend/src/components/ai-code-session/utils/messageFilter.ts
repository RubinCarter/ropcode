/**
 * Message filtering utilities
 *
 * Extracted from ClaudeCodeSession.tsx to separate concerns
 * Pure functions - no side effects
 */

import type { ClaudeStreamMessage } from "../types";
import { summarizeRuntimeMessage } from './runtimePresentation';

/**
 * Tools that have custom UI widgets and should hide their tool_result content
 */
const TOOLS_WITH_WIDGETS = new Set([
  'task',
  'agent',
  'agenttool',
  'edit',
  'multiedit',
  'todowrite',
  'todoread',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep',
  'websearch',
  'web_search',
  'webfetch',
  'agentoutputtool',
]);

/**
 * Check if a message is an internal debug/trace log that should be filtered
 */
function isInternalLog(message: any): boolean {
  const msgText = message?.message?.message || message?.message || '';

  return (
    msgText.includes('[CodexProvider') ||
    msgText.includes('DEBUG:') ||
    msgText.includes('TRACE:') ||
    msgText.startsWith('⚙️') ||
    msgText.length === 0
  );
}

/**
 * Check if a tool_result should be hidden (because it has a custom widget)
 */
function buildToolUseNamesById(messages: ClaudeStreamMessage[]): Map<string, string> {
  const toolUseNamesById = new Map<string, string>();

  messages.forEach((message) => {
    const contentBlocks = message.message?.content;
    if (message.type !== 'assistant' || !Array.isArray(contentBlocks)) return;

    contentBlocks.forEach((content: any) => {
      if (content?.type === 'tool_use' && content.id) {
        toolUseNamesById.set(content.id, String(content.name ?? '').toLowerCase());
      }
    });
  });

  return toolUseNamesById;
}

function shouldHideToolResult(
  content: any,
  toolUseNamesById: Map<string, string>
): boolean {
  if (!content.tool_use_id) return false;

  const toolName = toolUseNamesById.get(content.tool_use_id);
  return Boolean(toolName && (TOOLS_WITH_WIDGETS.has(toolName) || toolName.startsWith('mcp__')));
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const objectValue = value as { text?: unknown; content?: unknown; result?: unknown; output?: unknown };
  for (const candidate of [objectValue.text, objectValue.content, objectValue.result, objectValue.output]) {
    if (typeof candidate === 'string') return candidate;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join('\n');
  }

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function isNonEmptyText(value: unknown): boolean {
  return extractText(value).trim().length > 0;
}

function hasRenderableAssistantContent(message: ClaudeStreamMessage): boolean {
  const contentBlocks = message.message?.content;
  if (!Array.isArray(contentBlocks)) {
    return isNonEmptyText(contentBlocks);
  }

  return contentBlocks.some((content: any) => {
    if (content.type === 'text') {
      return isNonEmptyText(content.text);
    }

    if (content.type === 'thinking') {
      return true;
    }

    if (content.type === 'tool_use' || content.type === 'server_tool_use') {
      const toolName = String(content.name ?? '').toLowerCase();
      if (toolName === 'agentoutputtool') return false;
      return true;
    }

    return false;
  });
}

function hasRenderableUserContent(
  message: ClaudeStreamMessage,
  toolUseNamesById: Map<string, string>
): boolean {
  if (message.isMeta) return false;

  if (message.user_message) {
    return true;
  }

  const topLevelContent = (message as any).content;
  if (topLevelContent !== undefined && topLevelContent !== null) {
    if (!Array.isArray(topLevelContent)) {
      return isNonEmptyText(topLevelContent);
    }

    return topLevelContent.some((content: any) => isRenderableUserContentBlock(content, toolUseNamesById));
  }

  const nestedContent = message.message?.content;
  if (!nestedContent) {
    return false;
  }

  if (!Array.isArray(nestedContent)) {
    return isNonEmptyText(nestedContent);
  }

  return nestedContent.some((content: any) => isRenderableUserContentBlock(content, toolUseNamesById));
}

function isRenderableUserContentBlock(content: any, toolUseNamesById: Map<string, string>): boolean {
  if (!content) return false;

  if (content.type === "text") {
    return isNonEmptyText(content.text);
  }

  if (content.type === "tool_result") {
    return !shouldHideToolResult(content, toolUseNamesById);
  }

  return false;
}

function wouldStreamMessageRender(
  message: ClaudeStreamMessage,
  toolUseNamesById: Map<string, string>
): boolean {
  if (message.isMeta && !message.leafUuid && !message.summary) {
    return false;
  }

  if (message.leafUuid && message.summary && (message as any).type === "summary") {
    return true;
  }

  if (message.type === "system" && message.subtype === "init") {
    return true;
  }

  if (message.type === "assistant" && message.message) {
    return hasRenderableAssistantContent(message);
  }

  if (message.type === "user") {
    return hasRenderableUserContent(message, toolUseNamesById);
  }

  if (message.type === "error" || message.type === "result") {
    return true;
  }

  return summarizeRuntimeMessage(message as any) !== null;
}

function isHiddenByDefault(message: ClaudeStreamMessage): boolean {
  const runtimeMessage = message as unknown as {
    type?: string;
    subtype?: string;
    hidden_by_default?: boolean;
    debug_meta?: { hidden_by_default?: boolean };
    isSidechain?: boolean;
  };

  return (
    runtimeMessage.type === 'queue-operation' ||
    runtimeMessage.type === 'progress' ||
    (runtimeMessage.type === 'system' && runtimeMessage.subtype === 'api_retry') ||
    runtimeMessage.type === 'rate_limit_event' ||
    runtimeMessage.hidden_by_default === true ||
    runtimeMessage.debug_meta?.hidden_by_default === true
  );
}

/**
 * Transient runtime events that should collapse into a single "latest" card
 * when emitted in a row. The user only cares about the most recent state of
 * a retry/error storm, not the full history.
 *
 * Real assistant/user/result/tool_use messages are NOT collapsible — they
 * end the current transient sequence so a later transient starts a new card.
 */
function isCollapsibleTransientMessage(message: ClaudeStreamMessage): boolean {
  const msg = message as unknown as {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    error?: unknown;
  };

  if (msg.type === 'system' && (msg.subtype === 'api_retry' || msg.subtype === 'error')) {
    return true;
  }

  if (msg.type === 'rate_limit_event' || msg.type === 'raw') {
    return true;
  }

  // Top-level error events (e.g. server_error) without a result/tool payload.
  if (msg.type === 'error') {
    return true;
  }

  // Some providers emit error-flavored payloads under a generic type with
  // is_error / error set. Treat them as transient too.
  if (msg.is_error === true && !msg.type) {
    return true;
  }

  return false;
}

/**
 * Filter messages to only include those that should be displayed in the UI
 *
 * Filters out:
 * - Meta messages without meaningful content
 * - Internal debug/trace logs
 * - User messages that only contain tool results already shown in widgets
 */
function isDisplayableMessage(
  message: ClaudeStreamMessage,
  index: number,
  hiddenIndexes: Set<number> | undefined,
  toolUseNamesById: Map<string, string>
): boolean {
  if (hiddenIndexes?.has(index)) {
    return false;
  }

  if (isHiddenByDefault(message)) {
    return false;
  }

  // Skip meta messages that don't have meaningful content
  if (message.isMeta && !message.leafUuid && !message.summary) {
    return false;
  }

  // Filter out internal stderr messages
  if (message.type === "info" && message.subtype === "stderr") {
    if (isInternalLog(message)) {
      return false;
    }
  }

  if (!wouldStreamMessageRender(message, toolUseNamesById)) {
    return false;
  }

  return true;
}

export function getDisplayableMessages(
  messages: ClaudeStreamMessage[],
  hiddenIndexes?: Set<number>
): { indexes: number[]; messages: ClaudeStreamMessage[] } {
  const indexes: number[] = [];
  const displayableMessages: ClaudeStreamMessage[] = [];
  const toolUseNamesById = buildToolUseNamesById(messages);

  // Deduplicate incremental stream messages: Claude CLI emits progressive
  // updates for the same assistant turn as separate messages sharing one
  // message.id. When the final message of a turn is hidden (e.g. a subagent
  // launcher in hiddenIndexes), earlier intermediate messages with the same ID
  // are superseded so they don't flash in the main stream before disappearing.
  // Normal turns (where the last message is visible) are NOT deduped — the user
  // expects to see text + tool_use together in history.
  const lastIndexByMessageId = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msgId = (messages[i] as any).message?.id;
    if (msgId && messages[i].type === 'assistant') {
      lastIndexByMessageId.set(msgId, i);
    }
  }
  const supersededByMessageId = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const msgId = (messages[i] as any).message?.id;
    if (!msgId || messages[i].type !== 'assistant') continue;
    const lastIdx = lastIndexByMessageId.get(msgId);
    if (lastIdx === i) continue;
    if (lastIdx !== undefined && hiddenIndexes?.has(lastIdx)) {
      supersededByMessageId.add(i);
    }
  }

  // First pass: collapse consecutive transient runtime events (api_retry,
  // server_error, rate_limit_event, raw) into a single "latest" card so
  // long retry/error storms don't pile up as a tall list of duplicates.
  // A real assistant/user/result/tool message ends the sequence and forces
  // any subsequent transient event to start a fresh card.
  const supersededTransientIndexes = new Set<number>();
  let lastTransientIndex: number | null = null;
  for (let i = 0; i < messages.length; i++) {
    if (supersededByMessageId.has(i)) continue;
    if (!isDisplayableMessage(messages[i], i, hiddenIndexes, toolUseNamesById)) continue;
    if (isCollapsibleTransientMessage(messages[i])) {
      if (lastTransientIndex !== null) supersededTransientIndexes.add(lastTransientIndex);
      lastTransientIndex = i;
    } else {
      lastTransientIndex = null;
    }
  }

  messages.forEach((message, index) => {
    if (supersededByMessageId.has(index)) return;
    if (supersededTransientIndexes.has(index)) return;
    if (isDisplayableMessage(message, index, hiddenIndexes, toolUseNamesById)) {
      indexes.push(index);
      displayableMessages.push(message);
    }
  });

  return { indexes, messages: displayableMessages };
}

export function getDisplayableMessageIndexes(
  messages: ClaudeStreamMessage[],
  hiddenIndexes?: Set<number>
): number[] {
  return getDisplayableMessages(messages, hiddenIndexes).indexes;
}

export function filterDisplayableMessages(
  messages: ClaudeStreamMessage[],
  hiddenIndexes?: Set<number>
): ClaudeStreamMessage[] {
  return getDisplayableMessages(messages, hiddenIndexes).messages;
}
