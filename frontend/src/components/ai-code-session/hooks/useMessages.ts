/**
 * Messages state management hook
 *
 * Manages message-related state including:
 * - Message history
 * - Raw JSONL output
 * - Token counting
 * - Displayable message filtering
 */

import { useState, useEffect, useMemo, useRef } from "react";
import type { ClaudeStreamMessage } from "../types";
import { filterDisplayableMessages } from "../utils/messageFilter";

export interface UseMessagesReturn {
  // State
  messages: ClaudeStreamMessage[];
  totalTokens: number;
  displayableMessages: ClaudeStreamMessage[];
  agentOutputMap: Map<string, any>;

  // Setters
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;

  // Helpers
  addMessage: (message: ClaudeStreamMessage) => void;
  clearMessages: () => void;

  // Refs
  messagesLengthRef: React.MutableRefObject<number>;
}

/**
 * Hook to manage messages
 */
export function useMessages(): UseMessagesReturn {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);

  // Ref for stable access in callbacks
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;

  // Filter displayable messages
  const displayableMessages = useMemo(
    () => filterDisplayableMessages(messages),
    [messages]
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

  // Calculate total tokens from messages
  useEffect(() => {
    const tokens = messages.reduce((total, msg) => {
      if (msg.message?.usage) {
        return total + msg.message.usage.input_tokens + msg.message.usage.output_tokens;
      }
      if (msg.usage) {
        return total + msg.usage.input_tokens + msg.usage.output_tokens;
      }
      return total;
    }, 0);
    setTotalTokens(tokens);
  }, [messages]);

  // Helper functions
  const addMessage = (message: ClaudeStreamMessage) => {
    // Handle delta messages - accumulate into last assistant message
    if (message.type === 'assistant' && (message as any).is_delta && message.message?.content) {
      setMessages(prev => {
        // Find the last assistant message
        const lastIndex = prev.length - 1;

        // Safely get content
        const deltaContent = message.message?.content || [];

        // If there's no previous message or last message is not assistant, create new assistant message
        if (lastIndex < 0 || prev[lastIndex].type !== 'assistant') {
          // This is the first delta, create a new assistant message
          return [...prev, {
            type: 'assistant',
            message: {
              content: deltaContent
            }
          }];
        }

        // Check if the last message is also from delta (still accumulating)
        // If the last message has usage info, it's a complete message, don't accumulate
        if (prev[lastIndex].message?.usage) {
          // Last message is complete, create new message
          return [...prev, message];
        }

        // Accumulate delta into last assistant message
        const updatedMessages = [...prev];
        const lastMessage = updatedMessages[lastIndex];

        // Ensure message.content exists
        if (!lastMessage.message) {
          lastMessage.message = { content: [] };
        }
        if (!lastMessage.message.content) {
          lastMessage.message.content = [];
        }

        // Get delta text
        const deltaText = deltaContent[0]?.text || '';
        const lastContentIndex = lastMessage.message.content.length - 1;

        if (lastContentIndex >= 0 && lastMessage.message.content[lastContentIndex].type === 'text') {
          // Append to existing text block
          lastMessage.message.content[lastContentIndex].text += deltaText;
        } else {
          // Create new text block
          lastMessage.message.content.push({
            type: 'text',
            text: deltaText
          });
        }

        return updatedMessages;
      });
      return;
    }

    // Regular message - just append
    setMessages(prev => [...prev, message]);
  };

  const clearMessages = () => {
    setMessages([]);
    setTotalTokens(0);
  };

  return {
    messages,
    totalTokens,
    displayableMessages,
    agentOutputMap,
    setMessages,
    addMessage,
    clearMessages,
    messagesLengthRef,
  };
}
