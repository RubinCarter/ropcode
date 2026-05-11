/**
 * Messages state management hook
 *
 * Manages message-related state including:
 * - Message history
 * - Raw JSONL output
 * - Token counting
 * - Displayable message filtering
 */

import { useState, useMemo, useRef } from "react";
import type { ClaudeStreamMessage } from "../types";
import type { StreamMessageContext } from "../../StreamMessage";
import { getDisplayableMessages } from "../utils/messageFilter";
import { buildSubagentProgress, type SubagentProgressSummary } from "@/lib/subagentProgress";

type MessageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  total_tokens?: number;
};

export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  estimatedOutputTokens: number;
  totalTokens: number;
}

interface MessageDerivedState {
  tokenUsage: TokenUsageTotals;
  agentOutputMap: Map<string, any>;
  streamMessageContext: StreamMessageContext;
  agentOutputToolUseIds: Map<string, string>;
}

interface MessageState {
  messages: ClaudeStreamMessage[];
  derived: MessageDerivedState;
}

export interface UseMessagesReturn {
  // State
  messages: ClaudeStreamMessage[];
  totalTokens: number;
  tokenUsage: TokenUsageTotals;
  displayableMessages: ClaudeStreamMessage[];
  displayableMessageIndexes: number[];
  subagentProgress: SubagentProgressSummary;
  subagentTranscripts: Record<string, ClaudeStreamMessage[]>;
  agentOutputMap: Map<string, any>;
  streamMessageContext: StreamMessageContext;

  // Setters
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setSubagentTranscripts: React.Dispatch<React.SetStateAction<Record<string, ClaudeStreamMessage[]>>>;

  // Helpers
  addMessage: (message: ClaudeStreamMessage) => void;
  clearMessages: () => void;

  // Refs
  messagesLengthRef: React.MutableRefObject<number>;
  messagesRef: React.MutableRefObject<ClaudeStreamMessage[]>;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function usageInputTokens(usage?: MessageUsage): number {
  return usage
    ? numberValue(usage.input_tokens) + numberValue(usage.cache_creation_input_tokens) + numberValue(usage.cache_read_input_tokens)
    : 0;
}

function usageOutputTokens(usage?: MessageUsage): number {
  return usage ? numberValue(usage.output_tokens) : 0;
}

function textContentLength(message: ClaudeStreamMessage): number {
  const content = message.message?.content;
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, block) => {
    if (block?.type === 'text' && typeof block.text === 'string') {
      return total + block.text.length;
    }
    return total;
  }, 0);
}

function messageTokenContribution(message: ClaudeStreamMessage): TokenUsageTotals {
  const usage = message.message?.usage ?? message.usage;
  if (usage) {
    const inputTokens = usageInputTokens(usage);
    const outputTokens = usageOutputTokens(usage);
    return {
      inputTokens,
      outputTokens,
      estimatedOutputTokens: 0,
      totalTokens: inputTokens + outputTokens,
    };
  }

  if (message.type === 'assistant' && (message as any).is_delta !== true) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      estimatedOutputTokens: Math.round(textContentLength(message) / 4),
      totalTokens: 0,
    };
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedOutputTokens: 0,
    totalTokens: 0,
  };
}

function addTokenContribution(totals: TokenUsageTotals, contribution: TokenUsageTotals): TokenUsageTotals {
  if (
    contribution.inputTokens === 0 &&
    contribution.outputTokens === 0 &&
    contribution.estimatedOutputTokens === 0 &&
    contribution.totalTokens === 0
  ) {
    return totals;
  }

  return {
    inputTokens: totals.inputTokens + contribution.inputTokens,
    outputTokens: totals.outputTokens + contribution.outputTokens,
    estimatedOutputTokens: totals.estimatedOutputTokens + contribution.estimatedOutputTokens,
    totalTokens: totals.totalTokens + contribution.totalTokens,
  };
}

function replaceTokenContribution(
  totals: TokenUsageTotals,
  previousMessage: ClaudeStreamMessage,
  nextMessage: ClaudeStreamMessage,
): TokenUsageTotals {
  const previous = messageTokenContribution(previousMessage);
  const next = messageTokenContribution(nextMessage);
  if (
    previous.inputTokens === next.inputTokens &&
    previous.outputTokens === next.outputTokens &&
    previous.estimatedOutputTokens === next.estimatedOutputTokens &&
    previous.totalTokens === next.totalTokens
  ) {
    return totals;
  }

  return {
    inputTokens: totals.inputTokens - previous.inputTokens + next.inputTokens,
    outputTokens: totals.outputTokens - previous.outputTokens + next.outputTokens,
    estimatedOutputTokens: totals.estimatedOutputTokens - previous.estimatedOutputTokens + next.estimatedOutputTokens,
    totalTokens: totals.totalTokens - previous.totalTokens + next.totalTokens,
  };
}

function createEmptyStreamMessageContext(): StreamMessageContext {
  return {
    toolResults: new Map(),
    cwd: '',
    toolUseNamesById: new Map(),
    readToolPathsById: new Map(),
  };
}

function createEmptyDerivedMessagesState(): MessageDerivedState {
  return {
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedOutputTokens: 0,
      totalTokens: 0,
    },
    agentOutputMap: new Map(),
    streamMessageContext: createEmptyStreamMessageContext(),
    agentOutputToolUseIds: new Map(),
  };
}

function parseToolResultContent(content: any): any {
  try {
    const textContent = Array.isArray(content)
      ? content.find((item: any) => item.type === 'text')?.text
      : typeof content === 'string' ? content : null;
    return textContent ? JSON.parse(textContent) : undefined;
  } catch {
    return undefined;
  }
}

function applyMessageToDerivedState(previous: MessageDerivedState, message: ClaudeStreamMessage): MessageDerivedState {
  let tokenUsage = addTokenContribution(previous.tokenUsage, messageTokenContribution(message));
  let agentOutputMap = previous.agentOutputMap;
  let agentOutputToolUseIds = previous.agentOutputToolUseIds;
  let toolResults = previous.streamMessageContext.toolResults;
  let toolUseNamesById = previous.streamMessageContext.toolUseNamesById;
  let readToolPathsById = previous.streamMessageContext.readToolPathsById;
  let cwd = previous.streamMessageContext.cwd;
  let streamContextChanged = false;

  const ensureAgentOutputMap = () => {
    if (agentOutputMap === previous.agentOutputMap) agentOutputMap = new Map(agentOutputMap);
  };
  const ensureAgentOutputToolUseIds = () => {
    if (agentOutputToolUseIds === previous.agentOutputToolUseIds) agentOutputToolUseIds = new Map(agentOutputToolUseIds);
  };
  const ensureToolResults = () => {
    if (toolResults === previous.streamMessageContext.toolResults) toolResults = new Map(toolResults);
    streamContextChanged = true;
  };
  const ensureToolUseNamesById = () => {
    if (toolUseNamesById === previous.streamMessageContext.toolUseNamesById) toolUseNamesById = new Map(toolUseNamesById);
    streamContextChanged = true;
  };
  const ensureReadToolPathsById = () => {
    if (readToolPathsById === previous.streamMessageContext.readToolPathsById) readToolPathsById = new Map(readToolPathsById);
    streamContextChanged = true;
  };

  if (message.type === 'system' && message.subtype === 'init' && message.cwd && message.cwd !== cwd) {
    cwd = message.cwd;
    streamContextChanged = true;
  }

  const content = message.message?.content;
  if (message.type === 'assistant' && Array.isArray(content)) {
    content.forEach((block: any) => {
      if ((block?.type === 'tool_use' || block?.type === 'server_tool_use') && block.id) {
        const toolName = String(block.name ?? '').toLowerCase();
        if (toolUseNamesById.get(block.id) !== toolName) {
          ensureToolUseNamesById();
          toolUseNamesById.set(block.id, toolName);
        }

        if (toolName === 'read' && block.input?.file_path && readToolPathsById.get(block.id) !== block.input.file_path) {
          ensureReadToolPathsById();
          readToolPathsById.set(block.id, block.input.file_path);
        }

        if (toolName === 'agentoutputtool' && block.input?.agentId && agentOutputToolUseIds.get(block.id) !== block.input.agentId) {
          ensureAgentOutputToolUseIds();
          agentOutputToolUseIds.set(block.id, block.input.agentId);
        }
      }

      if (block?.tool_use_id && toolResults.get(block.tool_use_id) !== block) {
        ensureToolResults();
        toolResults.set(block.tool_use_id, block);
      }
    });
  }

  if (message.type === 'user' && Array.isArray(content)) {
    content.forEach((block: any) => {
      if (block?.type !== 'tool_result' || !block.tool_use_id) return;

      if (toolResults.get(block.tool_use_id) !== block) {
        ensureToolResults();
        toolResults.set(block.tool_use_id, block);
      }

      const agentId = agentOutputToolUseIds.get(block.tool_use_id);
      if (!agentId) return;

      const result = (message as any).toolUseResult ?? parseToolResultContent(block.content);
      if (result && agentOutputMap.get(agentId) !== result) {
        ensureAgentOutputMap();
        agentOutputMap.set(agentId, result);
      }
    });
  }

  return {
    tokenUsage,
    agentOutputMap,
    streamMessageContext: streamContextChanged
      ? { toolResults, cwd, toolUseNamesById, readToolPathsById }
      : previous.streamMessageContext,
    agentOutputToolUseIds,
  };
}

function replaceLastMessageInDerivedState(
  previous: MessageDerivedState,
  previousMessage: ClaudeStreamMessage,
  nextMessage: ClaudeStreamMessage,
): MessageDerivedState {
  const tokenUsage = replaceTokenContribution(previous.tokenUsage, previousMessage, nextMessage);
  return tokenUsage === previous.tokenUsage ? previous : { ...previous, tokenUsage };
}

function buildDerivedMessagesState(messages: ClaudeStreamMessage[]): MessageDerivedState {
  return messages.reduce(
    (derived, message) => applyMessageToDerivedState(derived, message),
    createEmptyDerivedMessagesState(),
  );
}

/**
 * Hook to manage messages
 */
export function useMessages(): UseMessagesReturn {
  const [messageState, setMessageState] = useState<MessageState>(() => ({
    messages: [],
    derived: createEmptyDerivedMessagesState(),
  }));
  const [subagentTranscripts, setSubagentTranscripts] = useState<Record<string, ClaudeStreamMessage[]>>({});
  const messages = messageState.messages;

  const setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>> = (nextMessagesOrUpdater) => {
    setMessageState((previous) => {
      const nextMessages = typeof nextMessagesOrUpdater === 'function'
        ? nextMessagesOrUpdater(previous.messages)
        : nextMessagesOrUpdater;

      if (nextMessages === previous.messages) return previous;
      return {
        messages: nextMessages,
        derived: buildDerivedMessagesState(nextMessages),
      };
    });
  };

  // Refs for stable access in callbacks (avoids stale closure in useEffect([]))
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const subagentProgress = useMemo(
    () => buildSubagentProgress(messages, subagentTranscripts),
    [messages, subagentTranscripts]
  );

  const displayable = useMemo(
    () => getDisplayableMessages(messages, subagentProgress.subagentMessageIndexes),
    [messages, subagentProgress.subagentMessageIndexes]
  );
  const displayableMessageIndexes = displayable.indexes;
  const displayableMessages = displayable.messages;

  const tokenUsage = messageState.derived.tokenUsage;
  const totalTokens = tokenUsage.totalTokens;

  // Use ref to batch delta updates and reduce re-renders
  const deltaBufferRef = useRef<string>('');
  const deltaFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Counter for locally-added user messages pending broadcast echo.
  // When the frontend adds a user message locally (before backend broadcasts it),
  // we increment this counter. When a broadcast user message arrives, we decrement
  // and skip it — that echo is for the same message we already added.
  // A counter (not a boolean) handles rapid successive sends correctly.
  const pendingLocalUserMessagesRef = useRef<number>(0);

  // Helper functions
  const addMessage = (message: ClaudeStreamMessage) => {
    // Ensure message has timestamp (ISO 8601 string to match JSONL format)
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    // Skip broadcast user messages that we already added locally.
    // When this client sends a prompt, it calls addMessage() for instant display,
    // then the backend broadcasts the same user message (with source:"broadcast")
    // to all clients. We skip that echo here; other clients (which didn't send
    // the message) won't have a pending count and will add it normally.
    if (message.type === 'user' && (message as any).source === 'broadcast') {
      if (pendingLocalUserMessagesRef.current > 0) {
        pendingLocalUserMessagesRef.current--;
        return;
      }
      // No pending local message — this was sent by another client, add it
    }

    // Track locally-added user messages (non-broadcast) so we can skip the echo
    if (message.type === 'user' && (message as any).source !== 'broadcast') {
      pendingLocalUserMessagesRef.current++;
    }

    // Handle delta messages - accumulate into last assistant message with batching
    if (message.type === 'assistant' && (message as any).is_delta && message.message?.content) {
      const deltaContent = message.message?.content || [];
      const deltaText = deltaContent[0]?.text || '';

      // Accumulate delta text in buffer
      deltaBufferRef.current += deltaText;

      // Clear any existing flush timeout
      if (deltaFlushTimeoutRef.current) {
        clearTimeout(deltaFlushTimeoutRef.current);
      }

      // Batch updates: flush buffer every 50ms to reduce re-renders
      deltaFlushTimeoutRef.current = setTimeout(() => {
        const bufferedText = deltaBufferRef.current;
        deltaBufferRef.current = '';

        if (!bufferedText) return;

        setMessageState(prev => {
          const lastIndex = prev.messages.length - 1;

          // If there's no previous message or last message is not assistant, create new assistant message
          if (lastIndex < 0 || prev.messages[lastIndex].type !== 'assistant') {
            const nextMessage: ClaudeStreamMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: bufferedText }]
              }
            };
            return {
              messages: [...prev.messages, nextMessage],
              derived: applyMessageToDerivedState(prev.derived, nextMessage),
            };
          }

          // If the last message has usage info, it's a complete message, don't accumulate
          if (prev.messages[lastIndex].message?.usage) {
            const nextMessage: ClaudeStreamMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: bufferedText }]
              }
            };
            return {
              messages: [...prev.messages, nextMessage],
              derived: applyMessageToDerivedState(prev.derived, nextMessage),
            };
          }

          // Accumulate delta into last assistant message
          // Clone only the last message to minimize object creation
          const updatedMessages = [...prev.messages];
          const previousLastMessage = updatedMessages[lastIndex];
          const lastMessage = { ...previousLastMessage };
          updatedMessages[lastIndex] = lastMessage;

          // Ensure message.content exists
          if (!lastMessage.message) {
            lastMessage.message = { content: [] };
          } else {
            lastMessage.message = { ...lastMessage.message };
          }
          if (!lastMessage.message.content) {
            lastMessage.message.content = [];
          } else {
            lastMessage.message.content = [...lastMessage.message.content];
          }

          const lastContentIndex = lastMessage.message.content.length - 1;

          if (lastContentIndex >= 0 && lastMessage.message.content[lastContentIndex].type === 'text') {
            // Clone and append to existing text block
            lastMessage.message.content[lastContentIndex] = {
              ...lastMessage.message.content[lastContentIndex],
              text: lastMessage.message.content[lastContentIndex].text + bufferedText
            };
          } else {
            // Create new text block
            lastMessage.message.content.push({
              type: 'text',
              text: bufferedText
            });
          }

          return {
            messages: updatedMessages,
            derived: replaceLastMessageInDerivedState(prev.derived, previousLastMessage, lastMessage),
          };
        });
      }, 50);

      return;
    }

    // Regular message - just append
    // Also flush any pending delta buffer first
    if (deltaFlushTimeoutRef.current) {
      clearTimeout(deltaFlushTimeoutRef.current);
      deltaFlushTimeoutRef.current = null;
    }
    if (deltaBufferRef.current) {
      const bufferedText = deltaBufferRef.current;
      deltaBufferRef.current = '';

      setMessageState(prev => {
        const lastIndex = prev.messages.length - 1;
        if (lastIndex >= 0 && prev.messages[lastIndex].type === 'assistant' && !prev.messages[lastIndex].message?.usage) {
          const updatedMessages = [...prev.messages];
          const previousLastMessage = updatedMessages[lastIndex];
          const lastMessage = { ...previousLastMessage };
          updatedMessages[lastIndex] = lastMessage;

          if (lastMessage.message?.content && lastMessage.message.content.length > 0) {
            lastMessage.message = { ...lastMessage.message };
            lastMessage.message.content = [...lastMessage.message.content];
            const lastContentIndex = lastMessage.message.content.length - 1;
            if (lastMessage.message.content[lastContentIndex].type === 'text') {
              lastMessage.message.content[lastContentIndex] = {
                ...lastMessage.message.content[lastContentIndex],
                text: lastMessage.message.content[lastContentIndex].text + bufferedText
              };
            }
          }

          const messagesWithNewMessage = [...updatedMessages, message];
          const derivedWithBufferedText = replaceLastMessageInDerivedState(prev.derived, previousLastMessage, lastMessage);
          return {
            messages: messagesWithNewMessage,
            derived: applyMessageToDerivedState(derivedWithBufferedText, message),
          };
        }

        return {
          messages: [...prev.messages, message],
          derived: applyMessageToDerivedState(prev.derived, message),
        };
      });
    } else {
      setMessageState(prev => ({
        messages: [...prev.messages, message],
        derived: applyMessageToDerivedState(prev.derived, message),
      }));
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setSubagentTranscripts({});
  };

  return {
    messages,
    totalTokens,
    tokenUsage,
    displayableMessages,
    displayableMessageIndexes,
    subagentProgress,
    subagentTranscripts,
    agentOutputMap: messageState.derived.agentOutputMap,
    streamMessageContext: messageState.derived.streamMessageContext,
    setMessages,
    setSubagentTranscripts,
    addMessage,
    clearMessages,
    messagesLengthRef,
    messagesRef,
  };
}
