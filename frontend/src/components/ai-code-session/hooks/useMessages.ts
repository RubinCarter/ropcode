/**
 * Messages state management hook
 *
 * Manages message-related state including:
 * - Message history
 * - Raw JSONL output
 * - Token counting
 * - Displayable message filtering
 */

import { useState, useMemo, useRef, useCallback } from "react";
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
  renderTick: number;

  // Setters
  setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>>;
  setSubagentTranscripts: React.Dispatch<React.SetStateAction<Record<string, ClaudeStreamMessage[]>>>;

  // Helpers
  addMessage: (message: ClaudeStreamMessage) => void;
  flushPendingMessages: () => void;
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

function estimateTokensForCharacters(characterCount: number): number {
  return characterCount > 0 ? Math.max(1, Math.round(characterCount / 4)) : 0;
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
    const contentLength = textContentLength(message);
    return {
      inputTokens: 0,
      outputTokens: 0,
      estimatedOutputTokens: estimateTokensForCharacters(contentLength),
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

function replaceEstimatedWithUsage(totals: TokenUsageTotals, message: ClaudeStreamMessage): TokenUsageTotals {
  const usage = message.message?.usage ?? message.usage;
  if (!usage || message.type !== 'assistant') return totals;

  const estimatedToReplace = estimateTokensForCharacters(textContentLength(message));
  if (estimatedToReplace === 0) return totals;

  return {
    ...totals,
    estimatedOutputTokens: Math.max(0, totals.estimatedOutputTokens - estimatedToReplace),
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
  let tokenUsage = replaceEstimatedWithUsage(
    addTokenContribution(previous.tokenUsage, messageTokenContribution(message)),
    message,
  );
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

function buildDerivedMessagesState(messages: ClaudeStreamMessage[]): MessageDerivedState {
  return messages.reduce(
    (derived, message) => applyMessageToDerivedState(derived, message),
    createEmptyDerivedMessagesState(),
  );
}

/**
 * Hook to manage messages
 *
 * Uses mutable array + version counter to avoid O(n) array copies on every
 * incoming message during streaming. The messages array is mutated in place
 * (push, in-place text append) and a version counter triggers React re-renders.
 */
export function useMessages(): UseMessagesReturn {
  const messagesRef = useRef<ClaudeStreamMessage[]>([]);
  const derivedRef = useRef<MessageDerivedState>(createEmptyDerivedMessagesState());
  const [version, setVersion] = useState(0);
  const [structuralVersion, setStructuralVersion] = useState(0);
  const [subagentTranscripts, setSubagentTranscripts] = useState<Record<string, ClaudeStreamMessage[]>>({});

  const messages = messagesRef.current;

  const setMessages: React.Dispatch<React.SetStateAction<ClaudeStreamMessage[]>> = (nextMessagesOrUpdater) => {
    const nextMessages = typeof nextMessagesOrUpdater === 'function'
      ? nextMessagesOrUpdater(messagesRef.current)
      : nextMessagesOrUpdater;

    if (nextMessages === messagesRef.current) return;
    messagesRef.current = nextMessages;
    derivedRef.current = buildDerivedMessagesState(nextMessages);
    setVersion(v => v + 1);
    setStructuralVersion(v => v + 1);
  };

  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;

  const prevSubagentIndexesRef = useRef<Set<number>>(new Set());

  const subagentProgress = useMemo(
    () => buildSubagentProgress(messages, subagentTranscripts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structuralVersion, subagentTranscripts]
  );

  const stableSubagentIndexes = useMemo(() => {
    const next = subagentProgress.subagentMessageIndexes;
    const prev = prevSubagentIndexesRef.current;
    if (next.size === prev.size) {
      let same = true;
      for (const idx of next) {
        if (!prev.has(idx)) { same = false; break; }
      }
      if (same) return prev;
    }
    prevSubagentIndexesRef.current = next;
    return next;
  }, [subagentProgress.subagentMessageIndexes]);

  const displayable = useMemo(
    () => getDisplayableMessages(messages, stableSubagentIndexes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structuralVersion, stableSubagentIndexes]
  );
  const displayableMessageIndexes = displayable.indexes;
  const displayableMessages = displayable.messages;

  const tokenUsage = derivedRef.current.tokenUsage;
  const totalTokens = tokenUsage.totalTokens;

  // Batch delta and regular messages with rAF
  const deltaBufferRef = useRef<string>('');
  const flushRafRef = useRef<number | null>(null);
  const messageQueueRef = useRef<ClaudeStreamMessage[]>([]);

  const pendingLocalUserMessagesRef = useRef<number>(0);

  const flushPending = () => {
    flushRafRef.current = null;
    const bufferedText = deltaBufferRef.current;
    deltaBufferRef.current = '';
    const queued = messageQueueRef.current;
    messageQueueRef.current = [];

    const msgs = messagesRef.current;
    let derived = derivedRef.current;
    let changed = false;
    let structural = false;

    // Apply buffered delta text
    if (bufferedText) {
      derived = {
        ...derived,
        tokenUsage: addTokenContribution(derived.tokenUsage, {
          inputTokens: 0,
          outputTokens: 0,
          estimatedOutputTokens: estimateTokensForCharacters(bufferedText.length),
          totalTokens: 0,
        }),
      };
      const lastIndex = msgs.length - 1;
      if (lastIndex >= 0 && msgs[lastIndex].type === 'assistant' && !msgs[lastIndex].message?.usage) {
        const lastMessage = msgs[lastIndex];
        if (!lastMessage.message) {
          lastMessage.message = { content: [{ type: 'text', text: bufferedText }] };
        } else if (!lastMessage.message.content || lastMessage.message.content.length === 0) {
          lastMessage.message.content = [{ type: 'text', text: bufferedText }];
        } else {
          const lastBlock = lastMessage.message.content[lastMessage.message.content.length - 1];
          if (lastBlock.type === 'text') {
            lastBlock.text += bufferedText;
          } else {
            lastMessage.message.content.push({ type: 'text', text: bufferedText });
          }
        }
        changed = true;
      } else {
        // Need a new assistant message
        const newMsg: ClaudeStreamMessage = {
          type: 'assistant',
          message: { content: [{ type: 'text', text: bufferedText }] }
        };
        msgs.push(newMsg);
        derived = applyMessageToDerivedState(derived, newMsg);
        changed = true;
        structural = true;
      }
    }

    // Apply queued regular messages
    for (const msg of queued) {
      msgs.push(msg);
      derived = applyMessageToDerivedState(derived, msg);
      changed = true;
      structural = true;
    }

    if (changed) {
      derivedRef.current = derived;
      setVersion(v => v + 1);
      if (structural) setStructuralVersion(v => v + 1);
    }
  };

  const scheduleFlush = () => {
    if (flushRafRef.current === null) {
      flushRafRef.current = requestAnimationFrame(flushPending);
    }
  };

  const flushPendingMessages = useCallback(() => {
    if (flushRafRef.current !== null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    flushPending();
  }, []);

  const addMessage = (message: ClaudeStreamMessage) => {
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    if (message.type === 'user' && (message as any).source === 'broadcast') {
      if (pendingLocalUserMessagesRef.current > 0) {
        pendingLocalUserMessagesRef.current--;
        return;
      }
    }

    if (message.type === 'user' && (message as any).source !== 'broadcast') {
      pendingLocalUserMessagesRef.current++;
    }

    // Delta messages — accumulate text in buffer
    if (message.type === 'assistant' && (message as any).is_delta && message.message?.content) {
      const deltaText = message.message.content[0]?.text || '';
      deltaBufferRef.current += deltaText;
      scheduleFlush();
      return;
    }

    // Regular messages share the same rAF flush so bursts only trigger one render.
    messageQueueRef.current.push(message);
    scheduleFlush();
  };

  const clearMessages = () => {
    messagesRef.current = [];
    derivedRef.current = createEmptyDerivedMessagesState();
    setVersion(v => v + 1);
    setStructuralVersion(v => v + 1);
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
    agentOutputMap: derivedRef.current.agentOutputMap,
    streamMessageContext: derivedRef.current.streamMessageContext,
    renderTick: version,
    setMessages,
    setSubagentTranscripts,
    addMessage,
    flushPendingMessages,
    clearMessages,
    messagesLengthRef,
    messagesRef,
  };
}
