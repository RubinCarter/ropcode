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
    hidden_by_default?: boolean;
    debug_meta?: { hidden_by_default?: boolean };
    isSidechain?: boolean;
  };

  return (
    runtimeMessage.type === 'queue-operation' ||
    runtimeMessage.type === 'progress' ||
    runtimeMessage.hidden_by_default === true ||
    runtimeMessage.debug_meta?.hidden_by_default === true
  );
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

  // Sidechain messages belong to the subagent panel, not the root stream.
  // This is a fallback for live stream where buildSubagentProgress may not have
  // seen the launcher yet and thus hasn't added the index to hiddenIndexes.
  if ((message as any).isSidechain === true) {
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

  // First pass: find the last index of each api_retry sequence so earlier ones can be collapsed.
  // A sequence ends when a non-api_retry displayable message appears after it.
  const supersededApiRetryIndexes = new Set<number>();
  let lastApiRetryIndex: number | null = null;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as any;
    if (!isDisplayableMessage(messages[i], i, hiddenIndexes, toolUseNamesById)) continue;
    if (msg.type === 'system' && msg.subtype === 'api_retry') {
      if (lastApiRetryIndex !== null) supersededApiRetryIndexes.add(lastApiRetryIndex);
      lastApiRetryIndex = i;
    } else {
      // Any other displayable message ends the current retry sequence
      lastApiRetryIndex = null;
    }
  }

  messages.forEach((message, index) => {
    if (supersededApiRetryIndexes.has(index)) return;
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
