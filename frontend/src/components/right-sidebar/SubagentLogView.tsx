import React, { useMemo } from "react";
import { Clock, Hash, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompactNumber, type ClaudeStreamMessageLike } from "@/lib/subagentProgress";
import { summarizeTranscript, type ParsedTranscript } from "@/lib/subagentLog";
import { StreamMessage, buildStreamMessageContext } from "../StreamMessage";
import { ErrorBoundary } from "../ErrorBoundary";

interface SubagentLogViewProps {
  transcript: ParsedTranscript;
  onLoadEarlier: () => void;
  className?: string;
}

const EMPTY_AGENT_OUTPUT_MAP = new Map<string, any>();

function formatElapsed(ms?: number): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return remSec ? `${minutes}m ${remSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
}

const SubagentLogViewBase: React.FC<SubagentLogViewProps> = ({
  transcript,
  onLoadEarlier,
  className,
}) => {
  const { messages, truncatedBefore, fileMissing, loadingEarlier } = transcript;
  const summary = useMemo(() => summarizeTranscript(messages), [messages]);
  const streamContext = useMemo(
    () => buildStreamMessageContext(messages as any),
    [messages],
  );
  const elapsed = formatElapsed(summary.elapsedMs);
  const toolEntries = useMemo(
    () => Array.from(summary.toolCounts.entries()).sort((a, b) => b[1].count - a[1].count),
    [summary.toolCounts],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {toolEntries.length === 0 && summary.totalTokens === 0 && !elapsed ? (
          <span className="italic">No activity yet</span>
        ) : null}
        {toolEntries.map(([name, count]) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"
            title={count.running > 0 ? `${count.running} running` : undefined}
          >
            <Wrench className="h-3 w-3" />
            <span className="font-medium text-foreground">{name}</span>
            <span>{count.count}</span>
            {count.running > 0 && (
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
            )}
          </span>
        ))}
        {summary.totalTokens > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
            <Hash className="h-3 w-3" />
            {formatCompactNumber(summary.totalTokens)}
          </span>
        )}
        {elapsed && (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>

      {fileMissing && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          Transcript file no longer available — session may have ended.
        </div>
      )}

      {truncatedBefore > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={onLoadEarlier}
          disabled={loadingEarlier}
        >
          {loadingEarlier ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          {loadingEarlier
            ? "Loading earlier messages…"
            : `Load ${truncatedBefore} earlier message${truncatedBefore === 1 ? "" : "s"}`}
        </Button>
      )}

      {messages.length === 0 ? (
        !fileMissing && (
          <div className="rounded border border-dashed p-2 text-center text-[11px] text-muted-foreground">
            Waiting for transcript output…
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          {messages.map((message, index) => (
            <ErrorBoundary key={`subagent-log-${index}`}>
              <StreamMessage
                message={message as any}
                streamMessages={messages as any}
                streamContext={streamContext}
                agentOutputMap={EMPTY_AGENT_OUTPUT_MAP}
              />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  );
};

export const SubagentLogView = React.memo(SubagentLogViewBase);

export type { ClaudeStreamMessageLike };
