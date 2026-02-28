import React, { useState, useEffect, useRef, useCallback } from "react";
import { debugLog, type LogEntry } from "@/lib/debug-log";
import { Trash2, ArrowDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<LogEntry['level'], string> = {
  error: "text-red-400",
  warn: "text-yellow-400",
  info: "text-blue-400",
  log: "text-foreground/80",
  debug: "text-muted-foreground",
};

const LEVEL_BG: Record<LogEntry['level'], string> = {
  error: "bg-red-500/10",
  warn: "bg-yellow-500/10",
  info: "",
  log: "",
  debug: "",
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export const DebugLogs: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>(() => debugLog.getEntries());
  const [filter, setFilter] = useState<LogEntry['level'] | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return debugLog.subscribe(() => setEntries([...debugLog.getEntries()]));
  }, []);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter);

  const counts = entries.reduce((acc, e) => {
    acc[e.level] = (acc[e.level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleCopy = useCallback(() => {
    const text = filtered.map(e =>
      `[${formatTime(e.timestamp)}] [${e.level.toUpperCase()}] ${e.args.join(" ")}`
    ).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-heading-4 mb-2">Debug Logs</h3>
        <p className="text-body-small text-muted-foreground">
          Console output captured in real-time. Useful for debugging on mobile.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'error', 'warn', 'info', 'log', 'debug'] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors",
              filter === level
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 hover:bg-muted text-muted-foreground"
            )}
          >
            {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
            {level !== 'all' && counts[level] ? ` (${counts[level]})` : ''}
          </button>
        ))}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-7">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAutoScroll(!autoScroll)}
          className={cn("gap-1.5 h-7", autoScroll && "text-primary")}>
          <ArrowDown className="h-3 w-3" />
          Auto-scroll
        </Button>
        <Button variant="ghost" size="sm" onClick={() => debugLog.clear()} className="gap-1.5 h-7 text-destructive">
          <Trash2 className="h-3 w-3" />
          Clear
        </Button>
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        className="h-[60vh] overflow-y-auto rounded-lg border bg-black/30 font-mono text-xs p-2 space-y-px"
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No logs yet</p>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className={cn("flex gap-2 px-1.5 py-0.5 rounded", LEVEL_BG[entry.level])}>
              <span className="text-muted-foreground shrink-0 select-none">
                {formatTime(entry.timestamp)}
              </span>
              <span className={cn("shrink-0 w-12 uppercase select-none", LEVEL_STYLES[entry.level])}>
                {entry.level}
              </span>
              <span className="break-all whitespace-pre-wrap">
                {entry.args.join(" ")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
