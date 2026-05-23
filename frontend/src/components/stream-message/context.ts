import type React from "react";
import type { ClaudeStreamMessage } from "../AgentExecution";

export interface StreamMessageContext {
  toolResults: Map<string, any>;
  cwd: string;
  toolUseNamesById: Map<string, string>;
  readToolPathsById: Map<string, string>;
}

export interface StreamMessageProps {
  message: ClaudeStreamMessage;
  className?: string;
  streamMessages: ClaudeStreamMessage[];
  streamContext?: StreamMessageContext;
  onLinkDetected?: (url: string) => void;
  agentOutputMap?: Map<string, any>;
  isStreamingText?: boolean;
  expandedCards?: Set<string>;
  onExpandedCardsChange?: React.Dispatch<React.SetStateAction<Set<string>>>;
  messageKey?: string;
  /**
   * Revision counter that the streaming-tail wrapper bumps on every text
   * delta. Read only by the memo comparator: a change here defeats memo so
   * the in-place mutated `message` object can re-render without us having to
   * clone it. Static rows leave this undefined and stay memoised.
   */
  tailRev?: number;
}

function getMessageContentBlocks(message: ClaudeStreamMessage): any[] {
  const content = message.message?.content ?? (message as any).content;
  return Array.isArray(content) ? content : [];
}

function getMessageToolUseIds(message: ClaudeStreamMessage): string[] {
  return getMessageContentBlocks(message)
    .filter((content) => content?.type === 'tool_use' && content.id)
    .map((content) => content.id);
}

function getMessageToolResultIds(message: ClaudeStreamMessage): string[] {
  return getMessageContentBlocks(message)
    .filter((content) => content?.type === 'tool_result' && content.tool_use_id)
    .map((content) => content.tool_use_id);
}

function getTaskAgentIds(message: ClaudeStreamMessage, context?: StreamMessageContext): string[] {
  if (!context) return [];

  return getMessageContentBlocks(message).flatMap((content) => {
    const toolName = String(content?.name ?? '').toLowerCase();
    if (content?.type !== 'tool_use' || !content.id) {
      return [];
    }
    if (toolName !== 'task' && toolName !== 'agent' && toolName !== 'agenttool') {
      return [];
    }

    const result = context.toolResults.get(content.id);
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string') return [];

    const match = text.match(/agentId:\s*([a-f0-9]+)/);
    return match ? [match[1]] : [];
  });
}

function expandedCardsChangedForMessage(prevCards: Set<string> | undefined, nextCards: Set<string> | undefined, messageKey: string | undefined, message: ClaudeStreamMessage): boolean {
  if (prevCards === nextCards) return false;
  if (!prevCards || !nextCards) return true;

  const prefix = `${messageKey ?? message.uuid ?? 'message'}:`;
  for (const key of prevCards) {
    if (key.startsWith(prefix) && !nextCards.has(key)) return true;
  }
  for (const key of nextCards) {
    if (key.startsWith(prefix) && !prevCards.has(key)) return true;
  }
  return false;
}

export function buildStreamMessageContext(streamMessages: ClaudeStreamMessage[]): StreamMessageContext {
  const toolResults = new Map<string, any>();
  const toolUseNamesById = new Map<string, string>();
  const readToolPathsById = new Map<string, string>();
  let cwd = "";

  streamMessages.forEach((msg) => {
    if (msg.type === "system" && msg.subtype === "init" && msg.cwd) {
      cwd = msg.cwd;
    }

    if (msg.type === "assistant" && msg.message?.content && Array.isArray(msg.message.content)) {
      msg.message.content.forEach((content: any) => {
        if ((content.type === "tool_use" || content.type === "server_tool_use") && content.id) {
          const toolName = String(content.name ?? "").toLowerCase();
          toolUseNamesById.set(content.id, toolName);
          if (toolName === "read" && content.input?.file_path) {
            readToolPathsById.set(content.id, content.input.file_path);
          }
        }
        if (content.tool_use_id) {
          toolResults.set(content.tool_use_id, content);
        }
      });
    }

    if (msg.type === "user" && msg.message?.content && Array.isArray(msg.message.content)) {
      msg.message.content.forEach((content: any) => {
        if (content.type === "tool_result" && content.tool_use_id) {
          toolResults.set(content.tool_use_id, content);
        }
      });
    }
  });

  return { toolResults, cwd, toolUseNamesById, readToolPathsById };
}

export function streamMessagePropsAreEqual(prev: StreamMessageProps, next: StreamMessageProps): boolean {
  if (prev.message !== next.message) return false;
  if (prev.tailRev !== next.tailRev) return false;
  if (prev.className !== next.className) return false;
  if (prev.onLinkDetected !== next.onLinkDetected) return false;
  if (prev.isStreamingText !== next.isStreamingText) return false;
  if (prev.onExpandedCardsChange !== next.onExpandedCardsChange) return false;
  if (prev.messageKey !== next.messageKey) return false;
  if (expandedCardsChangedForMessage(prev.expandedCards, next.expandedCards, next.messageKey, next.message)) return false;

  const prevContext = prev.streamContext;
  const nextContext = next.streamContext;
  if (!prevContext || !nextContext) {
    return prev.streamMessages === next.streamMessages && prev.agentOutputMap === next.agentOutputMap;
  }
  if (prevContext.cwd !== nextContext.cwd) return false;

  const toolUseIds = getMessageToolUseIds(next.message);
  for (const toolUseId of toolUseIds) {
    if (prevContext.toolResults.get(toolUseId) !== nextContext.toolResults.get(toolUseId)) return false;
  }

  const toolResultIds = getMessageToolResultIds(next.message);
  for (const toolResultId of toolResultIds) {
    if (prevContext.toolUseNamesById.get(toolResultId) !== nextContext.toolUseNamesById.get(toolResultId)) return false;
    if (prevContext.readToolPathsById.get(toolResultId) !== nextContext.readToolPathsById.get(toolResultId)) return false;
  }

  const agentIds = getTaskAgentIds(next.message, nextContext);
  for (const agentId of agentIds) {
    if (prev.agentOutputMap?.get(agentId) !== next.agentOutputMap?.get(agentId)) return false;
  }

  return true;
}
