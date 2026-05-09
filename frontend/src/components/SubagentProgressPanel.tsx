import React, { useState } from "react";
import { Bot, ChevronDown, ChevronRight, Hash, ListChecks, Loader2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCompactNumber, type ClaudeStreamMessageLike, type SubagentProgressSummary } from "@/lib/subagentProgress";
import { StreamMessage } from "./StreamMessage";
import { ErrorBoundary } from "./ErrorBoundary";

interface SubagentProgressPanelProps {
  summary: SubagentProgressSummary;
  streamMessages: ClaudeStreamMessageLike[];
  agentOutputMap?: Map<string, any>;
  className?: string;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "completed") return "default";
  if (status === "running") return "secondary";
  return "outline";
}

function statusLabel(status: string): string {
  if (status === "completed") return "Done";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  return "Unknown";
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text" && typeof item.text === "string") return item.text;
      if (item?.type === "tool_result") return stringifyContent(item.content);
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    }).join("\n");
  }
  if (content === undefined || content === null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function messageText(message: ClaudeStreamMessageLike): string {
  return stringifyContent(message.message?.content ?? message.content).trim();
}

function isDuplicatePromptMessage(message: ClaudeStreamMessageLike, prompt?: string): boolean {
  if (!prompt) return false;

  const role = String((message.message as any)?.role || message.type || "").toLowerCase();
  if (role !== "user") return false;

  const promptText = normalizeText(prompt);
  const text = normalizeText(messageText(message));
  if (!promptText || !text) return false;

  return text === promptText || text.includes(promptText) || promptText.includes(text);
}

function createPromptMessage(prompt: string): ClaudeStreamMessageLike {
  return {
    type: "user",
    message: {
      role: "user",
      content: prompt,
    } as any,
  };
}

function createResultMessage(result: unknown, isError: boolean): ClaudeStreamMessageLike {
  const text = typeof result === "string"
    ? result
    : `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;

  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: isError ? `Subagent failed:\n\n${text}` : text }],
    } as any,
  };
}

export const SubagentProgressPanel: React.FC<SubagentProgressPanelProps> = ({
  summary,
  agentOutputMap,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  if (summary.subagents.length === 0) return null;

  const toggleAgent = (id: string) => {
    setExpandedAgents((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const aggregateStatus = summary.failedCount > 0
    ? "failed"
    : summary.runningCount > 0
      ? "running"
      : "completed";

  return (
    <div className={cn("rounded-lg border bg-muted/30 overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="relative flex-shrink-0">
          <Bot className="h-4 w-4 text-primary" />
          {summary.runningCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Subagents</span>
            <span className="text-xs text-muted-foreground">
              {summary.subagents.length} agents
            </span>
            {summary.totalToolUseCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Wrench className="h-3 w-3" />
                {formatCompactNumber(summary.totalToolUseCount)} tools
              </span>
            )}
            {summary.totalTokenCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Hash className="h-3 w-3" />
                {formatCompactNumber(summary.totalTokenCount)} tokens
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {summary.runningCount > 0 && <span>{summary.runningCount} running</span>}
            {summary.completedCount > 0 && <span>{summary.completedCount} done</span>}
            {summary.failedCount > 0 && <span>{summary.failedCount} failed</span>}
          </div>
        </div>
        <Badge variant={statusBadgeVariant(aggregateStatus)} className="text-xs flex-shrink-0">
          {statusLabel(aggregateStatus)}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t divide-y bg-background/40">
          {summary.subagents.map((subagent) => {
            const agentExpanded = expandedAgents.has(subagent.id);
            const transcriptMessages = subagent.messages.filter((message) => !isDuplicatePromptMessage(message, subagent.prompt));
            const fallbackMessages: ClaudeStreamMessageLike[] = [];

            if (subagent.prompt && transcriptMessages.length === subagent.messages.length) {
              fallbackMessages.push(createPromptMessage(subagent.prompt));
            }
            if (transcriptMessages.length === 0 && (subagent.result || subagent.error)) {
              fallbackMessages.push(createResultMessage(subagent.error || subagent.result, Boolean(subagent.error)));
            }

            const renderMessages = [...fallbackMessages, ...transcriptMessages];

            return (
              <div key={subagent.id}>
                <button
                  type="button"
                  onClick={() => toggleAgent(subagent.id)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="pt-0.5 flex-shrink-0">
                    {subagent.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                    ) : (
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium truncate">{subagent.label}</span>
                      {subagent.toolUseCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {formatCompactNumber(subagent.toolUseCount)} tools
                        </span>
                      )}
                      {subagent.tokenCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {formatCompactNumber(subagent.tokenCount)} tokens
                        </span>
                      )}
                      {subagent.messageCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {subagent.messageCount} messages
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {subagent.lastActivity || subagent.description || subagent.prompt || "Waiting for output"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={statusBadgeVariant(subagent.status)} className="text-xs">
                      {statusLabel(subagent.status)}
                    </Badge>
                    <ChevronDown className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      !agentExpanded && "-rotate-90"
                    )} />
                  </div>
                </button>

                {agentExpanded && (
                  <div className="px-3 pb-3 space-y-3">
                    {renderMessages.length > 0 ? (
                      renderMessages.map((message, index) => (
                        <ErrorBoundary key={`${subagent.id}-${index}`}>
                          <StreamMessage
                            message={message as any}
                            streamMessages={renderMessages as any}
                            agentOutputMap={agentOutputMap}
                          />
                        </ErrorBoundary>
                      ))
                    ) : (
                      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                        Detailed transcript is not available for this subagent yet.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
