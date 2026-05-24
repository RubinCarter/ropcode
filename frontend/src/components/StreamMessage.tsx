import React, { useMemo, useState, useSyncExternalStore } from "react";
import type { ClaudeStreamMessage } from "./AgentExecution";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/hooks";
import { summarizeRuntimeMessage } from "./ai-code-session/utils/runtimePresentation";
import { AssistantMessageCard } from "./stream-message/AssistantMessageCard";
import {
  buildStreamMessageContext,
  streamMessagePropsAreEqual,
  type StreamMessageContext,
  type StreamMessageProps,
} from "./stream-message/context";
import {
  getAgentsSnapshot,
  loadAgentsOnce,
  subscribeAgents,
} from "./stream-message/rendering";
import { SummaryMessageCard } from "./stream-message/SummaryMessageCard";
import { UserMessageCard } from "./stream-message/UserMessageCard";
import {
  ErrorMessageCard,
  RenderFailureCard,
  ResultMessageCard,
  RuntimeEventCard,
  SystemInitCard,
} from "./stream-message/MessageCards";

export { buildStreamMessageContext };
export type { StreamMessageContext };

function formatEventDetails(message: ClaudeStreamMessage): string {
  try {
    const serialized = JSON.stringify(message, null, 2);
    return serialized.length > 2000 ? `${serialized.slice(0, 1999)}…` : serialized;
  } catch (_err) {
    return String(message);
  }
}

const StreamMessageComponent: React.FC<StreamMessageProps> = ({
  message,
  className,
  streamMessages,
  streamContext,
  onLinkDetected,
  agentOutputMap,
  isStreamingText = false,
  expandedCards,
  onExpandedCardsChange,
  messageKey,
}) => {
  const sharedStreamContext = useMemo(
    () => streamContext ?? buildStreamMessageContext(streamMessages),
    [streamContext, streamMessages]
  );

  const { theme } = useTheme();
  const syntaxTheme = useMemo(() => getClaudeSyntaxTheme(theme), [theme]);
  const [uncontrolledExpandedCards, setUncontrolledExpandedCards] = useState<Set<string>>(new Set());

  const agents = useSyncExternalStore(subscribeAgents, getAgentsSnapshot, getAgentsSnapshot);
  loadAgentsOnce();

  const getCardExpansionProps = (cardId: string, defaultExpanded: boolean) => {
    const currentExpandedCards = expandedCards ?? uncontrolledExpandedCards;
    const updateExpandedCards = onExpandedCardsChange ?? setUncontrolledExpandedCards;
    const expandedKey = `${messageKey ?? message.uuid ?? 'message'}:${cardId}`;

    return {
      defaultExpanded,
      expanded: currentExpandedCards.has(expandedKey) || (defaultExpanded && !currentExpandedCards.has(`${expandedKey}:collapsed`)),
      onExpandedChange: (expanded: boolean) => {
        updateExpandedCards((cards) => {
          const nextExpandedCards = new Set(cards);
          nextExpandedCards.delete(`${expandedKey}:collapsed`);
          if (expanded) {
            nextExpandedCards.add(expandedKey);
          } else {
            nextExpandedCards.delete(expandedKey);
            nextExpandedCards.add(`${expandedKey}:collapsed`);
          }
          return nextExpandedCards;
        });
      },
    };
  };

  const runtimeSummary = summarizeRuntimeMessage(message as any);

  try {
    if (message.isVisibleInTranscriptOnly === true && message.isCompactSummary === true) {
      const content = typeof message.message?.content === 'string'
        ? message.message.content
        : JSON.stringify(message.message?.content || '');
      const summaryExpansion = getCardExpansionProps('conversation-summary', false);
      return (
        <SummaryMessageCard
          message={message}
          content={content}
          expansion={summaryExpansion}
        />
      );
    }

    if (message.isMeta && !message.leafUuid && !message.summary) {
      return null;
    }

    if (message.type === "system" && message.subtype === "init") {
      return (
        <SystemInitCard
          message={message}
          runtimeSummary={runtimeSummary}
          expansion={getCardExpansionProps('system-init', false)}
        />
      );
    }

    if (message.type === "assistant" || (message.leafUuid && message.summary && (message as any).type === "summary")) {
      return (
        <AssistantMessageCard
          message={message}
          className={className}
          streamMessages={streamMessages}
          streamContext={sharedStreamContext}
          agentOutputMap={agentOutputMap}
          agents={agents}
          syntaxTheme={syntaxTheme}
          runtimeSummary={runtimeSummary}
          isStreamingText={isStreamingText}
          getCardExpansionProps={getCardExpansionProps}
        />
      );
    }

    if (message.type === "user") {
      return (
        <UserMessageCard
          message={message}
          className={className}
          streamContext={sharedStreamContext}
          agents={agents}
          onLinkDetected={onLinkDetected}
          getCardExpansionProps={getCardExpansionProps}
        />
      );
    }

    if (message.type === "error") {
      return <ErrorMessageCard message={message} className={className} />;
    }

    if (message.type === "result") {
      const resultExpansion = getCardExpansionProps('result-details', false);
      return (
        <ResultMessageCard
          message={message}
          runtimeSummary={runtimeSummary}
          syntaxTheme={syntaxTheme}
          className={className}
          expansion={resultExpansion}
        />
      );
    }

    if (runtimeSummary) {
      const eventDetails = formatEventDetails(message);
      const eventLabel = [message.type, message.subtype].filter(Boolean).join(' · ') || 'runtime event';
      return (
        <RuntimeEventCard
          runtimeSummary={runtimeSummary}
          eventDetails={eventDetails}
          eventLabel={eventLabel}
          className={className}
          expansion={getCardExpansionProps('event-details', false)}
        />
      );
    }

    return null;
  } catch (error) {
    console.error("Error rendering stream message:", error, message);
    return <RenderFailureCard error={error} />;
  }
};

export const StreamMessage = React.memo(StreamMessageComponent, streamMessagePropsAreEqual);
