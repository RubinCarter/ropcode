/**
 * Message filtering utilities
 *
 * Extracted from ClaudeCodeSession.tsx to separate concerns
 * Pure functions - no side effects
 */

import type { ClaudeStreamMessage } from "../types";
import { isSubagentEnvelopeMessage } from "@/lib/subagentProgress";

/**
 * Tools that have custom UI widgets and should hide their tool_result content
 */
const TOOLS_WITH_WIDGETS = new Set([
  'task',
  'edit',
  'multiedit',
  'todowrite',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep',
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
    if (message.type !== 'assistant' || !Array.isArray(message.message?.content)) return;

    message.message.content.forEach((content: any) => {
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

/**
 * Check if a user message has any visible content
 * 增强版：更宽容地处理用户消息，避免误过滤
 */
function hasVisibleContent(
  message: ClaudeStreamMessage,
  toolUseNamesById: Map<string, string>
): boolean {
  // 🔧 修复 1: 如果消息有 user_message 字段，说明是用户输入，应该显示
  if (message.user_message) {
    return true;
  }

  // 🔧 修复 2: 如果没有 message.content，但消息类型是 user，保守地保留它
  if (!message.message?.content) {
    return true;
  }

  // 如果 content 不是数组，尝试直接显示
  if (!Array.isArray(message.message.content)) {
    return true;
  }

  if (message.message.content.length === 0) {
    return false;
  }

  let hasVisible = false;

  for (const content of message.message.content) {
    // Text content is always visible
    if (content.type === "text") {
      // 🔧 修复 3: 即使 text 为空字符串，也应该显示（可能是有意的空消息）
      hasVisible = true;
      break;
    }

    // Tool results are visible if they don't have a custom widget
    if (content.type === "tool_result") {
      if (!shouldHideToolResult(content, toolUseNamesById)) {
        hasVisible = true;
        break;
      }
    }

    // 🔧 修复 4: 如果有其他类型的内容（如 image），也应该显示
    if (content.type && content.type !== "tool_result") {
      hasVisible = true;
      break;
    }
  }

  return hasVisible;
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

  if (isSubagentEnvelopeMessage(message)) {
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

  // Skip user messages that only contain tool results already displayed
  if (message.type === "user" && message.message) {
    if (message.isMeta) {
      return false;
    }

    if (!hasVisibleContent(message, toolUseNamesById)) {
      return false;
    }
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

  messages.forEach((message, index) => {
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
