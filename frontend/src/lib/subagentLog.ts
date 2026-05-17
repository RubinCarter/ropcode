import {
  assistantToolUses,
  messageTokens,
  type ClaudeStreamMessageLike,
} from "./subagentProgress";

export interface ToolCount {
  count: number;
  running: number;
}

export interface ParsedTranscript {
  messages: ClaudeStreamMessageLike[];
  lastLineIndex: number;
  truncatedBefore: number;
  fileMissing: boolean;
  loadingEarlier: boolean;
}

export interface TranscriptSummary {
  toolCounts: Map<string, ToolCount>;
  totalTokens: number;
  elapsedMs?: number;
  status: "running" | "completed" | "failed" | "unknown";
}

export function emptyTranscript(): ParsedTranscript {
  return {
    messages: [],
    lastLineIndex: 0,
    truncatedBefore: 0,
    fileMissing: false,
    loadingEarlier: false,
  };
}

export function parseTranscriptLines(rawLines: string[]): ClaudeStreamMessageLike[] {
  const out: ClaudeStreamMessageLike[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        out.push(parsed as ClaudeStreamMessageLike);
      }
    } catch (err) {
      console.warn("subagentLog: failed to parse JSONL line", err, raw.slice(0, 200));
    }
  }
  return out;
}

function tsMillis(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function extractTimestamp(message: ClaudeStreamMessageLike): number | undefined {
  const candidates = [
    (message as any).timestamp,
    (message as any).created_at,
    (message as any).startedAt,
    (message as any).started_at,
  ];
  for (const value of candidates) {
    const ms = tsMillis(value);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

function deriveStatus(messages: ClaudeStreamMessageLike[]): TranscriptSummary["status"] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type === "result") {
      const subtype = String((message as any).subtype ?? "").toLowerCase();
      if (subtype.includes("error") || (message as any).is_error === true) return "failed";
      return "completed";
    }
    const status = String(((message as any).status ?? "")).toLowerCase();
    if (status === "completed" || status === "success" || status === "done") return "completed";
    if (status === "failed" || status === "error") return "failed";
  }
  return messages.length > 0 ? "running" : "unknown";
}

export function summarizeTranscript(messages: ClaudeStreamMessageLike[]): TranscriptSummary {
  const toolCounts = new Map<string, ToolCount>();
  const toolUseIdToName = new Map<string, string>();
  const completedToolUseIds = new Set<string>();

  let totalTokens = 0;
  let firstTimestamp: number | undefined;
  let lastTimestamp: number | undefined;

  for (const message of messages) {
    totalTokens += messageTokens(message);

    const ts = extractTimestamp(message);
    if (ts !== undefined) {
      if (firstTimestamp === undefined || ts < firstTimestamp) firstTimestamp = ts;
      if (lastTimestamp === undefined || ts > lastTimestamp) lastTimestamp = ts;
    }

    for (const toolUse of assistantToolUses(message)) {
      const name = String(toolUse?.name ?? "").trim() || "(unknown)";
      const id = typeof toolUse?.id === "string" ? toolUse.id : undefined;
      const entry = toolCounts.get(name) ?? { count: 0, running: 0 };
      entry.count += 1;
      entry.running += 1;
      toolCounts.set(name, entry);
      if (id) {
        toolUseIdToName.set(id, name);
      }
    }

    if (message.type === "user") {
      const content = (message as any).message?.content ?? (message as any).content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
            const id = block.tool_use_id;
            if (completedToolUseIds.has(id)) continue;
            completedToolUseIds.add(id);
            const name = toolUseIdToName.get(id);
            if (!name) continue;
            const entry = toolCounts.get(name);
            if (entry && entry.running > 0) {
              entry.running -= 1;
            }
          }
        }
      }
    }
  }

  const elapsedMs = firstTimestamp !== undefined && lastTimestamp !== undefined
    ? Math.max(0, lastTimestamp - firstTimestamp)
    : undefined;

  return {
    toolCounts,
    totalTokens,
    elapsedMs,
    status: deriveStatus(messages),
  };
}
