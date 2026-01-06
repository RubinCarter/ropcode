import React, { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { StreamMessage } from '../StreamMessage';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaudeStreamMessage } from '../AgentExecution';

interface MessageListProps {
  messages: ClaudeStreamMessage[];
  projectPath: string;
  isStreaming: boolean;
  onLinkDetected?: (url: string) => void;
  className?: string;
}

export const MessageList: React.FC<MessageListProps> = React.memo(({
  messages,
  projectPath,
  isStreaming,
  onLinkDetected,
  className
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth'
    });
  }, []);

  if (messages.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-4 max-w-md"
        >
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <Terminal className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">Ready to start coding</h3>
            <p className="text-sm text-muted-foreground">
              {projectPath
                ? "Enter a prompt below to begin your Claude Code session"
                : "Select a project folder to begin"}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={cn("flex-1 overflow-hidden", className)}>
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        className="h-full"

        // Auto-scroll during streaming
        followOutput={(isAtBottom) => {
          if (!isAtBottom) return false;
          return isStreaming ? 'auto' : 'smooth';
        }}

        // Track bottom state
        atBottomStateChange={setAtBottom}
        atBottomThreshold={50}

        // Start at bottom
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}

        // Stable keys
        computeItemKey={(index, message) => `msg-${index}-${message.type}`}

        // Render each message
        itemContent={(index, message) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-2"
          >
            <StreamMessage
              message={message}
              streamMessages={messages}
              onLinkDetected={onLinkDetected}
            />
          </motion.div>
        )}

        // Footer for streaming indicator
        components={{
          Footer: () => isStreaming ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="sticky bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-background to-transparent"
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
                <span>Claude is thinking...</span>
              </div>
            </motion.div>
          ) : null,
        }}
      />
    </div>
  );
});
