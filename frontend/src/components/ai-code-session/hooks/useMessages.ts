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
import { filterDisplayableMessages, getDisplayableMessageIndexes } from "../utils/messageFilter";
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

function calculateTokenUsage(messages: ClaudeStreamMessage[]): TokenUsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedOutputTokens = 0;

  for (const message of messages) {
    const usage = message.message?.usage ?? message.usage;
    if (usage) {
      inputTokens += usageInputTokens(usage);
      outputTokens += usageOutputTokens(usage);
      continue;
    }

    if (message.type === 'assistant' && (message as any).is_delta !== true) {
      estimatedOutputTokens += Math.round(textContentLength(message) / 4);
    }
  }

  return {
    inputTokens,
    outputTokens,
    estimatedOutputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Hook to manage messages
 */
export function useMessages(): UseMessagesReturn {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [subagentTranscripts, setSubagentTranscripts] = useState<Record<string, ClaudeStreamMessage[]>>({});

  // Refs for stable access in callbacks (avoids stale closure in useEffect([]))
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const subagentProgress = useMemo(
    () => buildSubagentProgress(messages, subagentTranscripts),
    [messages, subagentTranscripts]
  );

  const displayableMessageIndexes = useMemo(
    () => getDisplayableMessageIndexes(messages, subagentProgress.subagentMessageIndexes),
    [messages, subagentProgress.subagentMessageIndexes]
  );

  // Filter displayable messages
  const displayableMessages = useMemo(
    () => filterDisplayableMessages(messages, subagentProgress.subagentMessageIndexes),
    [messages, subagentProgress.subagentMessageIndexes]
  );

  // Build agentId → AgentOutputTool result mapping
  // Note: JSONL history has 'toolUseResult' at root level, but live stream needs to parse from content
  const agentOutputMap = useMemo(() => {
    const map = new Map<string, any>();
    const toolUseMap = new Map<string, string>();

    // First pass: find AgentOutputTool calls and map tool_use_id → agentId
    messages.forEach((msg) => {
      if (msg.type === 'assistant' && msg.message?.content && Array.isArray(msg.message.content)) {
        msg.message.content.forEach((c: any) => {
          if (c.type === 'tool_use' && c.name === 'AgentOutputTool' && c.input?.agentId) {
            toolUseMap.set(c.id, c.input.agentId);
          }
        });
      }
    });

    // Second pass: find tool_result messages and map agentId → toolUseResult
    messages.forEach((msg: any) => {
      if (msg.type === 'user' && msg.message?.content && Array.isArray(msg.message.content)) {
        msg.message.content.forEach((c: any) => {
          if (c.type === 'tool_result' && c.tool_use_id) {
            const agentId = toolUseMap.get(c.tool_use_id);
            if (agentId) {
              // Try toolUseResult first (from JSONL history), then parse from content (live stream)
              let result = msg.toolUseResult;
              if (!result && c.content) {
                // Parse from tool_result content (live stream case)
                try {
                  const textContent = Array.isArray(c.content)
                    ? c.content.find((item: any) => item.type === 'text')?.text
                    : typeof c.content === 'string' ? c.content : null;
                  if (textContent) {
                    result = JSON.parse(textContent);
                  }
                } catch {
                  // Ignore parse errors
                }
              }
              if (result) {
                map.set(agentId, result);
              }
            }
          }
        });
      }
    });

    return map;
  }, [messages]);

  const tokenUsage = useMemo(() => calculateTokenUsage(messages), [messages]);
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

        setMessages(prev => {
          const lastIndex = prev.length - 1;

          // If there's no previous message or last message is not assistant, create new assistant message
          if (lastIndex < 0 || prev[lastIndex].type !== 'assistant') {
            return [...prev, {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: bufferedText }]
              }
            }];
          }

          // If the last message has usage info, it's a complete message, don't accumulate
          if (prev[lastIndex].message?.usage) {
            return [...prev, {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: bufferedText }]
              }
            }];
          }

          // Accumulate delta into last assistant message
          // Clone only the last message to minimize object creation
          const updatedMessages = [...prev];
          const lastMessage = { ...updatedMessages[lastIndex] };
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

          return updatedMessages;
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

      setMessages(prev => {
        const lastIndex = prev.length - 1;
        if (lastIndex >= 0 && prev[lastIndex].type === 'assistant' && !prev[lastIndex].message?.usage) {
          const updatedMessages = [...prev];
          const lastMessage = { ...updatedMessages[lastIndex] };
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

          return [...updatedMessages, message];
        }

        return [...prev, message];
      });
    } else {
      setMessages(prev => {
        return [...prev, message];
      });
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
    agentOutputMap,
    setMessages,
    setSubagentTranscripts,
    addMessage,
    clearMessages,
    messagesLengthRef,
    messagesRef,
  };
}
