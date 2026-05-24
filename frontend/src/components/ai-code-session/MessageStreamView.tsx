/**
 * MessageStreamView — owns the live message list rendering.
 *
 * Pulled out of `AiCodeSession` so the streaming list (Virtuoso + items) can
 * be re-rendered as a wrapped subtree. The component is a controlled,
 * `React.memo`-wrapped child that takes the entire `messagesState` returned
 * by `useSessionMessages()`, plus the imperative bits (`virtuosoRef`, viewport
 * config). It re-renders whenever the parent re-renders, but isolating the
 * Virtuoso lifecycle here keeps the parent JSX small and gives us a single
 * place to memoise the per-row callbacks.
 */
import React, { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { StreamMessage } from "../StreamMessage";
import { SubagentProgressPanel } from "../SubagentProgressPanel";
import type { ClaudeStreamMessage } from "./types";
import type { UseSessionMessagesReturn } from "./hooks/useSessionMessages";

interface MessageStreamViewProps {
  messagesState: UseSessionMessagesReturn;
  isLoading: boolean;
  virtuosoRef: React.Ref<VirtuosoHandle>;
  isScrollPaused: boolean;
  streamingViewportIncrease: { top: number; bottom: number };
  idleViewportIncrease: { top: number; bottom: number };
  followOutput: (isAtBottom: boolean) => false | 'auto' | 'smooth';
  setAtBottom: (isAtBottom: boolean) => void;
  expandedSubagentIds: Set<string>;
  setExpandedSubagentIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedMessageCards: Set<string> | undefined;
  setExpandedMessageCards: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleLinkDetected: ((url: string) => void) | undefined;
  error: string | null;
  onStreamItemsCountChange?: (count: number) => void;
}

/**
 * Subscribes to useSessionMessages tail-revision updates and re-renders only this
 * row when streaming text deltas arrive. Bypasses StreamMessage's React.memo
 * by feeding the revision through a `tailRev` prop that the memo comparator
 * checks.
 */
interface StreamingTailRowProps {
  message: ClaudeStreamMessage;
  streamMessages: ClaudeStreamMessage[];
  streamContext: any;
  onLinkDetected: ((url: string) => void) | undefined;
  agentOutputMap: Map<string, any>;
  expandedCards: Set<string> | undefined;
  onExpandedCardsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  messageKey: string;
  subscribeTailUpdate: (listener: () => void) => () => void;
  getTailRevision: () => number;
}

const StreamingTailRow: React.FC<StreamingTailRowProps> = ({
  subscribeTailUpdate,
  getTailRevision,
  ...streamMessageProps
}) => {
  const tailRev = useSyncExternalStore(subscribeTailUpdate, getTailRevision, getTailRevision);
  return (
    <StreamMessage
      {...streamMessageProps}
      isStreamingText={true}
      tailRev={tailRev}
    />
  );
};

export const MessageStreamView: React.FC<MessageStreamViewProps> = ({
  messagesState,
  isLoading,
  virtuosoRef,
  isScrollPaused: _isScrollPaused,
  streamingViewportIncrease,
  idleViewportIncrease,
  followOutput,
  setAtBottom,
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
        | { type: 'subagent-panel'; groupKey: string }
        | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number },
    ) =>
      item.type === 'subagent-panel'
        ? `subagent-panel:${item.groupKey}`
        : item.message.uuid || `msg-${item.originalIndex}`,
    [],
  );

  const itemContent = useCallback(
    (
      _: number,
      item:
        | { type: 'subagent-panel'; groupKey: string }
        | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number; isStreamingTail: boolean },
    ) => {
      if (item.type === 'subagent-panel') {
        // Filter the global summary down to this group's subagents so each
        // turn renders its own panel with its own progress counts. Falls
        // back to the full list when groupKey is the synthetic 'all' bucket
        // (subagents detected without a launcherMessageId).
        const groupSubagents = item.groupKey === '__no-launcher__'
          ? messagesState.subagentProgress.subagents.filter((s) => !s.launcherMessageId)
          : messagesState.subagentProgress.subagents.filter(
              (s) => s.launcherMessageId === item.groupKey,
            );
        const groupSummary = {
          ...messagesState.subagentProgress,
          subagents: groupSubagents,
          runningCount: groupSubagents.filter((s) => s.status === 'running').length,
          completedCount: groupSubagents.filter((s) => s.status === 'completed').length,
          failedCount: groupSubagents.filter((s) => s.status === 'failed').length,
        };
        return (
          <div className="w-full max-w-6xl mx-auto px-4 py-2">
            <SubagentProgressPanel
              summary={groupSummary}
              streamMessages={messagesState.messagesRef.current}
              agentOutputMap={messagesState.agentOutputMap}
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

      // The streaming-tail row subscribes to tail updates so its text content
      // refreshes on every flush WITHOUT triggering a re-render of
      // MessageStreamView / AiCodeSession. Static rows render through the
      // memoised StreamMessage path.
      if (item.isStreamingTail) {
        return (
          <div className="w-full max-w-6xl mx-auto px-4 py-2">
            <div className={cn(indentClass)}>
              <StreamingTailRow
                message={item.message}
                streamMessages={messagesState.messagesRef.current}
                streamContext={messagesState.streamMessageContext}
                onLinkDetected={handleLinkDetected}
                agentOutputMap={messagesState.agentOutputMap}
                expandedCards={expandedMessageCards}
                onExpandedCardsChange={setExpandedMessageCards}
                messageKey={item.message.uuid || `msg-${item.originalIndex}`}
                subscribeTailUpdate={messagesState.subscribeTailUpdate}
                getTailRevision={messagesState.getTailRevision}
              />
            </div>
          </div>
        );
      }

      return (
        <div className="w-full max-w-6xl mx-auto px-4 py-2">
          <div className={cn(indentClass)}>
            <StreamMessage
              message={item.message}
              streamMessages={messagesState.messagesRef.current}
              streamContext={messagesState.streamMessageContext}
              onLinkDetected={handleLinkDetected}
              agentOutputMap={messagesState.agentOutputMap}
              isStreamingText={false}
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
      messagesState.subscribeTailUpdate,
      messagesState.getTailRevision,
      expandedSubagentIds,
      setExpandedSubagentIds,
      expandedMessageCards,
      setExpandedMessageCards,
      handleLinkDetected,
    ],
  );

  const virtuosoComponents = useMemo(() => ({
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

  // Wrap items construction in useMemo: deps are stable refs from useMessages internal memoized output,
  // displayableMessageIndexes / subagentProgress only change refs when structuralVersion changes.
  // Under streaming setState storms, this is completely skipped when no structural changes;
  // previously commented "full view re-render is reasonable proxy for list shape changes",
  // but rebuilding N-length items array 60 times/sec after rAF batching is pure waste — useMemo cost is far less.
  const messages = messagesState.messagesRef.current;
  const items = useMemo(() => {
    // Group subagents by their launcher's assistant message id so each turn
    // gets its own panel anchored to where that turn's launchers actually
    // appeared. anchorIndex is the *last* message index touched by the group's
    // subagents — pushing the panel just past this point keeps it visually
    // adjacent to the launcher batch even when more messages stream in later.
    const groupAnchors = new Map<string, number>();
    for (const subagent of messagesState.subagentProgress.subagents) {
      const groupKey = subagent.launcherMessageId ?? '__no-launcher__';
      let maxIndex = -1;
      for (const idx of subagent.messageIndexes) {
        if (idx > maxIndex) maxIndex = idx;
      }
      const existing = groupAnchors.get(groupKey);
      if (existing === undefined || maxIndex > existing) {
        groupAnchors.set(groupKey, maxIndex);
      }
    }
    const pendingGroups = Array.from(groupAnchors.entries())
      .map(([groupKey, anchorIndex]) => ({ groupKey, anchorIndex }))
      .sort((a, b) => a.anchorIndex - b.anchorIndex);
    let groupCursor = 0;

    const built: Array<
      | { type: 'subagent-panel'; groupKey: string }
      | { type: 'message'; message: ClaudeStreamMessage; originalIndex: number; isStreamingTail: boolean }
    > = [];

    messagesState.displayableMessageIndexes.forEach((originalIndex) => {
      while (
        groupCursor < pendingGroups.length &&
        originalIndex > pendingGroups[groupCursor].anchorIndex
      ) {
        built.push({ type: 'subagent-panel', groupKey: pendingGroups[groupCursor].groupKey });
        groupCursor++;
      }

      const message = messages[originalIndex];
      if (!message) return;

      built.push({
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

    while (groupCursor < pendingGroups.length) {
      built.push({ type: 'subagent-panel', groupKey: pendingGroups[groupCursor].groupKey });
      groupCursor++;
    }

    return built;
    // messages read via messagesRef, structural changes driven by displayableMessageIndexes ref changes;
    // isStreamingTail real-time refresh uses subscribeTailUpdate, that path doesn't depend on this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesState.subagentProgress, messagesState.displayableMessageIndexes, isLoading]);

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
