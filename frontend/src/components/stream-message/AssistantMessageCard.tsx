import React from "react";
import { Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ClaudeStreamMessage } from "../AgentExecution";
import { SummaryWidget, ThinkingWidget } from "../tool-widgets";
import type { GetCardExpansionProps, StreamMessageContext } from "./context";
import { MarkdownContent, renderWithSystemInstructions } from "./rendering";
import { renderToolUseContent } from "./ToolUseRenderer";
import { stringifyMessageValue } from "./contentText";

interface AssistantMessageCardProps {
  message: ClaudeStreamMessage;
  className?: string;
  streamMessages?: ClaudeStreamMessage[];
  streamContext: StreamMessageContext;
  agentOutputMap?: Map<string, any>;
  agents: Map<string, any>;
  syntaxTheme: any;
  runtimeSummary?: string | null;
  isStreamingText?: boolean;
  getCardExpansionProps: GetCardExpansionProps;
}

export const AssistantMessageCard: React.FC<AssistantMessageCardProps> = ({
  message,
  className,
  streamMessages,
  streamContext,
  agentOutputMap,
  agents,
  syntaxTheme,
  runtimeSummary,
  isStreamingText,
  getCardExpansionProps,
}) => {
  if (message.leafUuid && message.summary && (message as any).type === "summary") {
    return <SummaryWidget summary={message.summary} leafUuid={message.leafUuid} />;
  }

  if (message.type !== "assistant" || !message.message) {
    return null;
  }

  const msg = message.message;
  let renderedSomething = false;

  const contentNodes = Array.isArray(msg.content)
    ? msg.content.map((content: any, idx: number) => {
        if (content.type === "text") {
          const textContent = stringifyMessageValue(content.text || content);
          renderedSomething = true;

          const systemInstructionContent = renderWithSystemInstructions(textContent, agents, `asst-${idx}-`, getCardExpansionProps);
          if (systemInstructionContent) {
            return <div key={idx}>{systemInstructionContent}</div>;
          }

          if (isStreamingText) {
            return (
              <div key={idx} className="text-sm whitespace-pre-wrap break-words leading-6">
                {textContent}
              </div>
            );
          }

          return <MarkdownContent key={idx} text={textContent} syntaxTheme={syntaxTheme} />;
        }

        if (content.type === "thinking") {
          renderedSomething = true;
          return (
            <div key={idx}>
              <ThinkingWidget
                thinking={content.thinking || ''}
                signature={content.signature}
                {...getCardExpansionProps(`thinking-${idx}`, false)}
              />
            </div>
          );
        }

        if (content.type === "tool_use" || content.type === "server_tool_use") {
          const widget = renderToolUseContent({
            content,
            index: idx,
            streamMessages,
            streamContext,
            agentOutputMap,
            getCardExpansionProps,
          });
          if (widget) {
            renderedSomething = true;
            return <div key={idx}>{widget}</div>;
          }
        }

        return null;
      })
    : null;

  if (!renderedSomething) {
    return null;
  }

  return (
    <Card className={cn("border-primary/20 bg-primary/5", className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Bot className="h-5 w-5 text-primary mt-0.5" />
          <div className="flex-1 space-y-2 min-w-0">
            {runtimeSummary && (
              <div className="text-xs text-muted-foreground">{runtimeSummary}</div>
            )}
            {contentNodes}
            {msg.usage && (
              <div className="text-xs text-muted-foreground mt-2">
                Tokens: {msg.usage.input_tokens} in, {msg.usage.output_tokens} out
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
