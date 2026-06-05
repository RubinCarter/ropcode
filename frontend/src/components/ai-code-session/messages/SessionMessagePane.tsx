import React from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp } from "lucide-react";
import type { VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { MessageStreamView } from "../MessageStreamView";
import type { UseSessionMessagesReturn } from "../hooks/useSessionMessages";

interface SessionMessagePaneProps {
  messagesState: UseSessionMessagesReturn;
  isLoading: boolean;
  virtuosoRef: React.RefObject<VirtuosoHandle>;
  isScrollPaused: boolean;
  onScrollPausedChange: (paused: boolean) => void;
  streamingViewportIncrease: { top: number; bottom: number };
  idleViewportIncrease: { top: number; bottom: number };
  followOutput: (isAtBottom: boolean) => false | 'auto' | 'smooth';
  setAtBottom: (isAtBottom: boolean) => void;
  expandedSubagentIds: Set<string>;
  setExpandedSubagentIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedMessageCards: Set<string>;
  setExpandedMessageCards: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleLinkDetected: ((url: string) => void) | undefined;
  error: string | null;
  streamItemsCount: number;
  onStreamItemsCountChange: (count: number) => void;
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
}

export const SessionMessagePane: React.FC<SessionMessagePaneProps> = ({
  messagesState,
  isLoading,
  virtuosoRef,
  isScrollPaused,
  onScrollPausedChange,
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
  streamItemsCount,
  onStreamItemsCountChange,
  scrollToBottom,
}) => {
  return (
    <div className="relative flex-1">
      <MessageStreamView
        messagesState={messagesState}
        isLoading={isLoading}
        virtuosoRef={virtuosoRef}
        isScrollPaused={isScrollPaused}
        streamingViewportIncrease={streamingViewportIncrease}
        idleViewportIncrease={idleViewportIncrease}
        followOutput={followOutput}
        setAtBottom={setAtBottom}
        expandedSubagentIds={expandedSubagentIds}
        setExpandedSubagentIds={setExpandedSubagentIds}
        expandedMessageCards={expandedMessageCards}
        setExpandedMessageCards={setExpandedMessageCards}
        handleLinkDetected={handleLinkDetected}
        error={error}
        onStreamItemsCountChange={onStreamItemsCountChange}
      />

      {streamItemsCount > 5 && (
        <div className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4">
          <div className="max-w-6xl w-full flex justify-end">
            <div className="flex items-center bg-background/95 border rounded-full shadow-sm overflow-hidden pointer-events-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onScrollPausedChange(!isScrollPaused)}
                className="px-3 py-2 hover:bg-accent rounded-none active:scale-[0.97]"
                aria-label={isScrollPaused ? "Resume auto-scroll" : "Lock scroll position"}
                title={isScrollPaused ? "Resume auto-scroll" : "Lock scroll position"}
              >
                {isScrollPaused ? (
                  <ArrowUpFromLine className="h-4 w-4" />
                ) : (
                  <ArrowDownToLine className="h-4 w-4" />
                )}
              </Button>
              <div className="w-px h-6 bg-border" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  virtuosoRef.current?.scrollToIndex({
                    index: 0,
                    align: 'start',
                    behavior: 'smooth',
                  });
                }}
                className="px-3 py-2 hover:bg-accent rounded-none active:scale-[0.97]"
                aria-label="Scroll to top"
                title="Scroll to top"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-border" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => scrollToBottom('smooth')}
                className="px-3 py-2 hover:bg-accent rounded-none active:scale-[0.97]"
                aria-label="Scroll to bottom"
                title="Scroll to bottom"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
