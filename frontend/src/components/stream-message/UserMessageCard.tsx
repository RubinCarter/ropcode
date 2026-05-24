import React from "react";
import { User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getUserMessagePresentation } from "../ai-code-session/utils/messagePresentation";
import type { ClaudeStreamMessage } from "../AgentExecution";
import { CommandOutputWidget, CommandWidget } from "../tool-widgets";
import { CollapsibleTextCard } from "./CollapsibleTextCard";
import type { GetCardExpansionProps, StreamMessageContext } from "./context";
import { stringifyMessageValue } from "./contentText";
import { parseAgentMentions, renderWithSystemInstructions } from "./rendering";
import { renderToolResultContent } from "./ToolResultRenderer";

interface UserMessageCardProps {
  message: ClaudeStreamMessage;
  className?: string;
  streamContext: StreamMessageContext;
  agents: Map<string, any>;
  onLinkDetected?: (url: string) => void;
  getCardExpansionProps: GetCardExpansionProps;
}

export const UserMessageCard: React.FC<UserMessageCardProps> = ({
  message,
  className,
  streamContext,
  agents,
  onLinkDetected,
  getCardExpansionProps,
}) => {
  if (message.type !== "user" || message.isMeta) {
    return null;
  }

  const msg = message.message || message;
  const userPresentation = getUserMessagePresentation(message as any);
  let renderedSomething = false;

  const simpleContent = typeof msg.content === 'string' || (msg.content && !Array.isArray(msg.content))
    ? renderUserText({
        text: stringifyMessageValue(msg.content),
        agents,
        presentation: userPresentation,
        expansionKey: 'user-string',
        onLinkDetected,
        getCardExpansionProps,
      })
    : null;
  if (simpleContent) {
    renderedSomething = true;
  }

  const arrayContent = Array.isArray(msg.content)
    ? msg.content.map((content: any, idx: number) => {
        if (content.type === "tool_result") {
          const rendered = renderToolResultContent({
            content,
            index: idx,
            streamContext,
            getCardExpansionProps,
          });
          if (rendered) {
            renderedSomething = true;
            return <React.Fragment key={idx}>{rendered}</React.Fragment>;
          }
          return null;
        }

        if (content.type === "text") {
          const textContent = stringifyMessageValue(content.text || content);
          const textPresentation = getUserMessagePresentation({
            type: 'user',
            message: { content: [{ type: 'text', text: textContent }] },
          });
          const rendered = renderUserText({
            text: textContent,
            agents,
            presentation: textPresentation,
            expansionKey: `user-text-${idx}`,
            getCardExpansionProps,
          });
          if (rendered) {
            renderedSomething = true;
            return <React.Fragment key={idx}>{rendered}</React.Fragment>;
          }
        }

        return null;
      })
    : null;

  if (!renderedSomething) {
    return null;
  }

  return (
    <Card className={cn("border-muted-foreground/20 bg-muted/20", className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <User className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1 space-y-2 min-w-0">
            {simpleContent}
            {arrayContent}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface RenderUserTextOptions {
  text: string;
  agents: Map<string, any>;
  presentation: ReturnType<typeof getUserMessagePresentation>;
  expansionKey: string;
  onLinkDetected?: (url: string) => void;
  getCardExpansionProps: GetCardExpansionProps;
}

function renderUserText({
  text,
  agents,
  presentation,
  expansionKey,
  onLinkDetected,
  getCardExpansionProps,
}: RenderUserTextOptions): React.ReactNode {
  if (text.trim() === '') {
    return null;
  }

  const commandMatch = text.match(/<command-name>(.+?)<\/command-name>[\s\S]*?<command-message>(.+?)<\/command-message>[\s\S]*?<command-args>(.*?)<\/command-args>/);
  if (commandMatch) {
    const [, commandName, commandMessage, commandArgs] = commandMatch;
    return (
      <CommandWidget
        commandName={commandName.trim()}
        commandMessage={commandMessage.trim()}
        commandArgs={commandArgs?.trim()}
      />
    );
  }

  const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (stdoutMatch) {
    const [, output] = stdoutMatch;
    return <CommandOutputWidget output={output} onLinkDetected={onLinkDetected} />;
  }

  const systemInstructionContent = renderWithSystemInstructions(text, agents, `${expansionKey}-`);
  if (systemInstructionContent) {
    return systemInstructionContent;
  }

  if (presentation.collapsible) {
    return (
      <CollapsibleTextCard
        title={presentation.title}
        preview={presentation.preview}
        {...getCardExpansionProps(expansionKey, presentation.defaultExpanded)}
      >
        <div className="text-sm whitespace-pre-wrap">
          {parseAgentMentions(text, agents)}
        </div>
      </CollapsibleTextCard>
    );
  }

  return (
    <div className="text-sm whitespace-pre-wrap">
      {parseAgentMentions(text, agents)}
    </div>
  );
}
