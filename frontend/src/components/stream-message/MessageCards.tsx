import React from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Terminal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ClaudeStreamMessage } from "../AgentExecution";
import { SystemInitializedWidget } from "../tool-widgets";
import { CollapsibleTextCard } from "./CollapsibleTextCard";
import { MarkdownContent } from "./rendering";

interface CardExpansionProps {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

interface SystemInitCardProps {
  message: ClaudeStreamMessage;
  runtimeSummary?: string | null;
  expansion: CardExpansionProps;
}

interface ErrorMessageCardProps {
  message: ClaudeStreamMessage;
  className?: string;
}

interface ResultMessageCardProps {
  message: ClaudeStreamMessage;
  runtimeSummary?: string | null;
  syntaxTheme: any;
  className?: string;
  expansion: CardExpansionProps;
}

interface RuntimeEventCardProps {
  runtimeSummary: string;
  eventDetails: string;
  eventLabel: string;
  className?: string;
  expansion: CardExpansionProps;
}

interface RenderFailureCardProps {
  error: unknown;
}

export const SystemInitCard: React.FC<SystemInitCardProps> = ({ message, runtimeSummary, expansion }) => (
  <div className="space-y-2">
    {runtimeSummary && (
      <div className="text-xs text-muted-foreground">{runtimeSummary}</div>
    )}
    <SystemInitializedWidget
      sessionId={message.session_id}
      model={message.model}
      cwd={message.cwd}
      tools={message.tools}
      {...expansion}
    />
  </div>
);

export const ErrorMessageCard: React.FC<ErrorMessageCardProps> = ({ message, className }) => {
  const errorMessage = message.error?.message || message.error || "Unknown error";

  return (
    <Card className={cn("border-destructive/20 bg-destructive/5", className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm text-destructive">Error</h4>
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap break-words">
              {typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage, null, 2)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const ResultMessageCard: React.FC<ResultMessageCardProps> = ({ message, runtimeSummary, syntaxTheme, className, expansion }) => {
  const isError = message.is_error || message.subtype?.includes("error");
  const expanded = Boolean(expansion.expanded);

  return (
    <Card className={cn(
      isError ? "border-destructive/20 bg-destructive/5" : "border-green-500/20 bg-green-500/5",
      className
    )}>
      <CardContent className="p-4">
        {runtimeSummary && (
          <div className="mb-2 text-xs text-muted-foreground">{runtimeSummary}</div>
        )}
        <button
          onClick={() => expansion.onExpandedChange?.(!expanded)}
          className="w-full flex items-start gap-3 text-left hover:opacity-80 transition-opacity"
        >
          {isError ? (
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <h4 className="font-semibold text-sm">
              {isError ? "Execution Failed" : "Execution Complete"}
            </h4>
          </div>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-0.5",
            expanded && "rotate-180"
          )} />
        </button>

        {expanded && (
          <div className="ml-8 mt-4 space-y-2">
            {message.result && <MarkdownContent text={message.result} syntaxTheme={syntaxTheme} />}

            {message.error && (
              <div className="text-sm text-destructive">{message.error}</div>
            )}

            <div className="text-xs text-muted-foreground space-y-1 mt-2">
              {((message.cost_usd !== undefined && message.cost_usd !== null) ||
                (message.total_cost_usd !== undefined && message.total_cost_usd !== null)) && (
                <div>Cost: ${(message.cost_usd || message.total_cost_usd || 0).toFixed(4)} USD</div>
              )}
              {message.duration_ms !== undefined && (
                <div>Duration: {(message.duration_ms / 1000).toFixed(2)}s</div>
              )}
              {message.num_turns !== undefined && (
                <div>Turns: {message.num_turns}</div>
              )}
              {message.usage && (
                <div>
                  Total tokens: {message.usage.input_tokens + message.usage.output_tokens}
                  ({message.usage.input_tokens} in, {message.usage.output_tokens} out)
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const RuntimeEventCard: React.FC<RuntimeEventCardProps> = ({ runtimeSummary, eventDetails, eventLabel, className, expansion }) => (
  <Card className={cn("border-muted bg-muted/20", className)}>
    <CardContent className="p-4">
      <div className="flex items-start gap-3">
        <Terminal className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{runtimeSummary}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{eventLabel}</span>
          </div>
          <CollapsibleTextCard title="Event details" preview="Click to expand event JSON" {...expansion}>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-xs text-muted-foreground">
              {eventDetails}
            </pre>
          </CollapsibleTextCard>
        </div>
      </div>
    </CardContent>
  </Card>
);

export const RenderFailureCard: React.FC<RenderFailureCardProps> = ({ error }) => (
  <Card className="border-destructive/20 bg-destructive/5">
    <CardContent className="p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium">Error rendering message</p>
          <p className="text-xs text-muted-foreground mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
);
