/**
 * MessageStreamView — owns the live message list rendering.
 *
 * Pulled out of `AiCodeSession` so the streaming list (Virtuoso + items) can
 * be re-rendered as a wrapped subtree. The component is a controlled,
 * `React.memo`-wrapped child that takes the entire `messagesState` returned
 * by `useMessages()`, plus the imperative bits (`virtuosoRef`, viewport
 * config). It re-renders whenever the parent re-renders, but isolating the
 * Virtuoso lifecycle here keeps the parent JSX small and gives us a single
 * place to memoise the per-row callbacks.
 */
import React, { useCallback, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { StreamMessage } from "../StreamMessage";
import { SubagentProgressPanel } from "../SubagentProgressPanel";
import { MessageScrollSeekPlaceholder } from "../MessageScrollSeekPlaceholder";
import type { ClaudeStreamMessage } from "./types";
import type { UseMessagesReturn } from "./hooks/useMessages";

interface MessageStreamViewProps {
  messagesState: UseMessagesReturn;
  isLoading: boolean;
  virtuosoRef: React.Ref<VirtuosoHandle>;
  isScrollPaused: boolean;
  scrollSeekConfiguration: any;
  streamingViewportIncrease: { top: number; bottom: number };
  idleViewportIncrease: { top: number; bottom: number };
  followOutput: (isAtBottom: boolean) => false | 'auto' | 'smooth';
  setAtBottom: (isAtBottom: boolean) => void;
  isSubagentPanelExpanded: boolean;
  setIsSubagentPanelExpanded: (expanded: boolean) => void;
  expandedSubagentIds: Set<string>;
  setExpandedSubagentIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedMessageCards: Set<string> | undefined;
  setExpandedMessageCards: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleLinkDetected: ((url: string) => void) | undefined;
  error: string | null;
  onStreamItemsCountChange?: (count: number) => void;
}

function ScrollSeekPlaceholder(props: { height: number }) {
  return <MessageScrollSeekPlaceholder {...props} className="w-full max-w-6xl mx-auto" />;
}

export const MessageStreamView: React.FC<MessageStreamViewProps> = ({
  messagesState,
  isLoading,
  virtuosoRef,
  isScrollPaused: _isScrollPaused,
  scrollSeekConfiguration,
  streamingViewportIncrease,
  idleViewportIncrease,
  followOutput,
  setAtBottom,
  isSubagentPanelExpanded,
  setIsSubagentPanelExpanded,
  expandedSubagentIds,
  setExpandedSubagentIds,
  expandedMessageCards,
  setExpandedMessageCards,
  handleLinkDetected,
  error,
  onStreamItemsCountChange,
}) => {
  const computeItemKey = useCallback(
    (
      _: number,
      item:
        | { type: 'subagent-panel' }
        | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number },
    ) =>
      item.type === 'subagent-panel'
        ? 'subagent-panel'
        : item.message.uuid || `msg-${item.originalIndex}`,
    [],
  );

  const itemContent = useCallback(
    (
      _: number,
      item:
        | { type: 'subagent-panel' }
        | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number; isStreamingTail: boolean },
    ) => {
      if (item.type === 'subagent-panel') {
        return (
          <div className="w-full max-w-6xl mx-auto px-4 py-2">
            <SubagentProgressPanel
              summary={messagesState.subagentProgress}
              streamMessages={messagesState.messagesRef.current}
              agentOutputMap={messagesState.agentOutputMap}
              expanded={isSubagentPanelExpanded}
              onExpandedChange={setIsSubagentPanelExpanded}
              expandedAgents={expandedSubagentIds}
              onExpandedAgentsChange={setExpandedSubagentIds}
            />
          </div>
        );
      }

      const depth = messagesState.subagentProgress.messageDepthByIndex.get(item.originalIndex) ?? 0;
      const indentClass = depth === 0
        ? ''
        : depth === 1
          ? 'pl-4 ml-2 border-l-2 border-purple-400/40'
          : 'pl-4 ml-6 border-l-2 border-purple-400/30';

      return (
        <div className="w-full max-w-6xl mx-auto px-4 py-2">
          <div className={cn(indentClass)}>
            <StreamMessage
              message={item.message}
              streamMessages={messagesState.messagesRef.current}
              streamContext={messagesState.streamMessageContext}
              onLinkDetected={handleLinkDetected}
              agentOutputMap={messagesState.agentOutputMap}
              isStreamingText={item.isStreamingTail}
              expandedCards={expandedMessageCards}
              onExpandedCardsChange={setExpandedMessageCards}
              messageKey={item.message.uuid || `msg-${item.originalIndex}`}
            />
          </div>
        </div>
      );
    },
    [
      messagesState.agentOutputMap,
      messagesState.messagesRef,
      messagesState.streamMessageContext,
      messagesState.subagentProgress,
      isSubagentPanelExpanded,
      setIsSubagentPanelExpanded,
      expandedSubagentIds,
      setExpandedSubagentIds,
      expandedMessageCards,
      setExpandedMessageCards,
      handleLinkDetected,
    ],
  );

  const virtuosoComponents = useMemo(() => ({
    ScrollSeekPlaceholder,
    Header: () => <div className="pt-6" />,
    Footer: () => (
      <>
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive mx-4 max-w-6xl">
            {error}
          </div>
        )}
        <div className="h-60" />
      </>
    ),
  }), [error]);

  // streamItems is intentionally NOT memoised — the whole view re-renders on
  // each render tick, which is the only reasonable proxy for "the message
  // list might have changed shape". A useMemo here would just add overhead.
  const messages = messagesState.messagesRef.current;
  const subagentIndexes = messagesState.subagentProgress.subagents.flatMap((subagent) =>
    Array.from(subagent.messageIndexes),
  );
  const firstSubagentIndex = Math.min(...subagentIndexes);
  let insertedSubagentPanel = false;
  const items: Array<
    | { type: 'subagent-panel' }
    | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number; isStreamingTail: boolean }
  > = [];

  messagesState.displayableMessageIndexes.forEach((originalIndex) => {
    if (
      messagesState.subagentProgress.subagents.length > 0 &&
      !insertedSubagentPanel &&
      Number.isFinite(firstSubagentIndex) &&
      originalIndex > firstSubagentIndex
    ) {
      items.push({ type: 'subagent-panel' });
      insertedSubagentPanel = true;
    }

    const message = messages[originalIndex];
    if (!message) return;

    items.push({
      type: 'message',
      message,
      originalIndex,
      isStreamingTail:
        isLoading &&
        originalIndex === messages.length - 1 &&
        message?.type === 'assistant' &&
        !message.message?.usage,
    });
  });

  if (messagesState.subagentProgress.subagents.length > 0 && !insertedSubagentPanel) {
    items.push({ type: 'subagent-panel' });
  }

  // Surface the count back to the parent so it can decide whether to render
  // peripheral chrome (scroll buttons). Only fires when the count actually
  // changes to avoid an infinite microtask loop.
  const prevItemsCountRef = useRef(0);
  if (onStreamItemsCountChange && items.length !== prevItemsCountRef.current) {
    prevItemsCountRef.current = items.length;
    queueMicrotask(() => onStreamItemsCountChange(items.length));
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      className="h-full"
      increaseViewportBy={isLoading ? streamingViewportIncrease : idleViewportIncrease}
      scrollSeekConfiguration={scrollSeekConfiguration}
      followOutput={followOutput}
      atBottomStateChange={setAtBottom}
      atBottomThreshold={100}
      initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      components={virtuosoComponents}
    />
  );
};
