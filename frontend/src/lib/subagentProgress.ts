export interface ClaudeStreamMessageLike {
  type?: string;
  subtype?: string;
  message?: {
    content?: any[];
    usage?: TokenUsage;
  };
  usage?: TokenUsage;
  [key: string]: any;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
  [key: string]: any;
}

export type SubagentStatus = "running" | "completed" | "failed" | "unknown";

export function isSubagentEnvelopeMessage(message: ClaudeStreamMessageLike): boolean {
  const runtimeMessage = message as any;
  return (
    runtimeMessage.isSidechain === true ||
    runtimeMessage.parent_tool_use_id != null ||
    runtimeMessage.parentToolUseID != null ||
    runtimeMessage.parentToolUseId != null
  );
}

export interface SubagentProgress {
  id: string;
  label: string;
  description?: string;
  prompt?: string;
  status: SubagentStatus;
  toolUseCount: number;
  tokenCount: number;
  messageCount: number;
  lastActivity?: string;
  launcherToolUseId?: string;
  agentId?: string;
  result?: unknown;
  error?: unknown;
  messages: ClaudeStreamMessageLike[];
  messageIndexes: Set<number>;
}

export interface SubagentProgressSummary {
  subagents: SubagentProgress[];
  rootMessages: ClaudeStreamMessageLike[];
  rootMessageIndexes: Set<number>;
  subagentMessageIndexes: Set<number>;
  messageDepthByIndex: Map<number, number>;
  totalToolUseCount: number;
  totalTokenCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
}

type MutableSubagentProgress = Omit<SubagentProgress, "messageIndexes"> & {
  messageIndexes: Set<number>;
};

const SUBAGENT_TOOL_NAMES = new Set([
  "agent",
  "agenttool",
  "task",
]);

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageTokens(usage?: TokenUsage): number {
  if (!usage) return 0;
  if (typeof usage.total_tokens === "number") return usage.total_tokens;

  return (
    numberValue(usage.input_tokens) +
    numberValue(usage.output_tokens) +
    numberValue(usage.cache_creation_input_tokens) +
    numberValue(usage.cache_read_input_tokens)
  );
}

function messageTokens(message: ClaudeStreamMessageLike): number {
  return usageTokens(message.message?.usage) + usageTokens(message.usage);
}

function assistantToolUses(message: ClaudeStreamMessageLike): any[] {
  if (message.type !== "assistant" || !Array.isArray(message.message?.content)) {
    return [];
  }

  return message.message.content.filter((content) => content?.type === "tool_use");
}

function countToolUses(message: ClaudeStreamMessageLike): number {
  return assistantToolUses(message).length;
}

function isLauncherToolResultMessage(message: ClaudeStreamMessageLike, toolUseToSubagentId: Map<string, string>): boolean {
  if (message.type !== "user") return false;
  const content = message.message?.content ?? message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => block?.type === "tool_result" && block.tool_use_id && toolUseToSubagentId.has(String(block.tool_use_id)));
}

function isTaskLifecycleSystemMessage(message: ClaudeStreamMessageLike): boolean {
  if (message.type !== "system") return false;
  const subtype = String(message.subtype ?? "");
  return subtype === "task_progress" || subtype === "task_started" || subtype === "task_notification";
}

function getToolResultBlocks(message: ClaudeStreamMessageLike): any[] {
  const content = message.message?.content ?? message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "tool_result" && block.tool_use_id);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text" && typeof item.text === "string") return item.text;
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

function messageTextContent(message: ClaudeStreamMessageLike): string {
  return stringifyContent(message.message?.content ?? message.content);
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function promptsMatch(parentPrompt: string | undefined, transcriptPrompt: string): boolean {
  if (!parentPrompt) return false;

  const parent = normalizePromptText(parentPrompt);
  const transcript = normalizePromptText(transcriptPrompt);
  if (!parent || !transcript) return false;

  return parent === transcript || transcript.includes(parent) || parent.includes(transcript);
}

function extractTranscriptPrompt(transcript: ClaudeStreamMessageLike[]): string {
  for (const message of transcript) {
    if (message.type !== "user") continue;
    const text = messageTextContent(message).trim();
    if (text) return text;
  }

  return transcript[0] ? messageTextContent(transcript[0]).trim() : "";
}

function transcriptToolUseCount(transcript: ClaudeStreamMessageLike[]): number {
  return transcript.reduce((sum, message) => sum + countToolUses(message), 0);
}

function transcriptTokenCount(transcript: ClaudeStreamMessageLike[]): number {
  return transcript.reduce((sum, message) => sum + messageTokens(message), 0);
}

function transcriptLastActivity(transcript: ClaudeStreamMessageLike[]): string | undefined {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const toolUses = assistantToolUses(transcript[index]);
    const lastToolUse = toolUses[toolUses.length - 1];
    if (lastToolUse?.name) return String(lastToolUse.name);
  }
  return undefined;
}

function normalizeAgentId(agentId: string): string {
  return agentId.replace(/^agent-/, "");
}

function extractAgentIdFromText(text: string): string | undefined {
  const agentId = text.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1];
  return agentId ? normalizeAgentId(agentId) : undefined;
}

function extractAgentIdFromResult(resultBlock: any): string | undefined {
  return extractAgentIdFromText(stringifyContent(resultBlock?.content));
}

function hasErrorResult(resultBlock: any): boolean {
  if (resultBlock?.is_error === true || resultBlock?.isError === true) return true;

  const text = stringifyContent(resultBlock?.content).trim().toLowerCase();
  return Boolean(text && /^(error|failed|failure)\b/.test(text));
}

function getInputValue(input: any, names: string[]): string | undefined {
  for (const name of names) {
    const value = input?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function labelFromInput(input: any, fallback: string): string {
  return (
    getInputValue(input, ["description", "name", "subagent_type", "subagentType", "agentType", "agent_type"]) ??
    fallback
  );
}

function isSubagentLauncher(toolUse: any): boolean {
  const name = String(toolUse?.name ?? "").toLowerCase();
  const input = toolUse?.input;

  if (SUBAGENT_TOOL_NAMES.has(name)) return true;
  if (name === "agentoutputtool") return false;

  return Boolean(
    input?.agentId ||
    input?.agent_id ||
    input?.subagent_type ||
    input?.subagentType ||
    input?.agentType ||
    input?.agent_type
  );
}

function statusFromAgentOutput(agentData: any): SubagentStatus | undefined {
  const status = String(agentData?.status ?? "").toLowerCase();
  if (status === "completed" || status === "done" || status === "success") return "completed";
  if (status === "error" || status === "failed" || status === "failure") return "failed";
  if (status === "running" || status === "pending") return "running";
  return undefined;
}

function ensureSubagent(
  subagentsById: Map<string, MutableSubagentProgress>,
  id: string,
  label: string,
): MutableSubagentProgress {
  const existing = subagentsById.get(id);
  if (existing) return existing;

  const subagent: MutableSubagentProgress = {
    id,
    label,
    status: "running",
    toolUseCount: 0,
    tokenCount: 0,
    messageCount: 0,
    messages: [],
    messageIndexes: new Set(),
  };
  subagentsById.set(id, subagent);
  return subagent;
}

function addMessageToSubagent(
  subagent: MutableSubagentProgress,
  message: ClaudeStreamMessageLike,
  index: number,
  options: { includeMessage?: boolean; countMessage?: boolean } = {},
): void {
  if (subagent.messageIndexes.has(index)) return;

  const { includeMessage = true, countMessage = true } = options;
  subagent.messageIndexes.add(index);

  if (includeMessage) {
    subagent.messages.push(message);
    subagent.messageCount = subagent.messages.length;
  }

  if (!countMessage) return;

  subagent.toolUseCount += countToolUses(message);
  subagent.tokenCount += messageTokens(message);

  const toolUses = assistantToolUses(message);
  const lastToolUse = toolUses[toolUses.length - 1];
  if (lastToolUse?.name) {
    subagent.lastActivity = String(lastToolUse.name);
  }
}

function applyTaskProgressEvent(
  subagentsById: Map<string, MutableSubagentProgress>,
  message: ClaudeStreamMessageLike,
  index: number,
  toolUseToSubagentId: Map<string, string>,
): boolean {
  if (message.type !== "system" || !message.task_id || (message.subtype !== "task_progress" && message.subtype !== "task_started")) {
    return false;
  }

  const taskId = String(message.task_id);
  const linkedToolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
  const subagentId = linkedToolUseId ? toolUseToSubagentId.get(linkedToolUseId) ?? taskId : taskId;
  const subagent = ensureSubagent(
    subagentsById,
    subagentId,
    String(message.description || taskId),
  );

  if (linkedToolUseId) {
    toolUseToSubagentId.set(linkedToolUseId, subagentId);
    subagent.launcherToolUseId = subagent.launcherToolUseId ?? linkedToolUseId;
  }

  subagent.description = String(message.description || subagent.description || "");
  subagent.toolUseCount = Math.max(subagent.toolUseCount, numberValue(message.usage?.tool_uses));
  subagent.tokenCount = Math.max(subagent.tokenCount, usageTokens(message.usage));
  subagent.lastActivity = message.last_tool_name || message.description || subagent.lastActivity;
  addMessageToSubagent(subagent, message, index, { countMessage: false });
  return true;
}

function applyAgentOutputResult(
  subagentsById: Map<string, MutableSubagentProgress>,
  result: any,
  index: number,
  message: ClaudeStreamMessageLike,
  agentIdToSubagentId: Map<string, string>,
): boolean {
  if (!result?.agents || typeof result.agents !== "object") return false;

  let handled = false;
  for (const [rawAgentId, agentData] of Object.entries<any>(result.agents)) {
    const agentId = normalizeAgentId(rawAgentId);
    const subagentId = agentIdToSubagentId.get(agentId) ?? agentId;
    const subagent = ensureSubagent(
      subagentsById,
      subagentId,
      String(agentData?.description || agentData?.name || agentId),
    );
    subagent.agentId = agentId;
    subagent.description = agentData?.description || subagent.description;
    const status = statusFromAgentOutput(agentData);
    if (status) subagent.status = status;
    if (agentData?.result) {
      subagent.result = agentData.result;
      subagent.lastActivity = "Completed";
    }
    if (agentData?.error) {
      subagent.error = agentData.error;
      subagent.lastActivity = "Error";
    }
    addMessageToSubagent(subagent, message, index, { countMessage: false });
    handled = true;
  }
  return handled;
}

export function buildSubagentProgress(
  messages: ClaudeStreamMessageLike[],
  subagentTranscripts: Record<string, ClaudeStreamMessageLike[]> = {},
): SubagentProgressSummary {
  const subagentsById = new Map<string, MutableSubagentProgress>();
  const toolUseToSubagentId = new Map<string, string>();
  const agentIdToSubagentId = new Map<string, string>();
  const subagentMessageIndexes = new Set<number>();
  const messageDepthByIndex = new Map<number, number>();
  const subagentDepth = new Map<string, number>();

  const assignToSubagent = (subagentId: string, index: number) => {
    if (messageDepthByIndex.has(index)) return;
    const depth = subagentDepth.get(subagentId) ?? 1;
    messageDepthByIndex.set(index, depth);
  };

  messages.forEach((message, index) => {
    if (applyTaskProgressEvent(subagentsById, message, index, toolUseToSubagentId)) {
      if (isTaskLifecycleSystemMessage(message)) subagentMessageIndexes.add(index);
      return;
    }

    for (const toolUse of assistantToolUses(message)) {
      if (!isSubagentLauncher(toolUse)) continue;

      const id = String(toolUse.id || toolUse.input?.agentId || toolUse.input?.agent_id || `subagent-${index}`);
      const isNew = !subagentsById.has(id);
      const subagent = ensureSubagent(subagentsById, id, labelFromInput(toolUse.input, `Subagent ${subagentsById.size + 1}`));
      subagent.description = getInputValue(toolUse.input, ["description"]) ?? subagent.description;
      subagent.prompt = getInputValue(toolUse.input, ["prompt"]);
      subagent.launcherToolUseId = toolUse.id;

      if (toolUse.input?.agentId || toolUse.input?.agent_id) {
        const agentId = normalizeAgentId(String(toolUse.input.agentId || toolUse.input.agent_id));
        subagent.agentId = agentId;
        agentIdToSubagentId.set(agentId, id);
      }

      if (toolUse.id) toolUseToSubagentId.set(toolUse.id, id);

      // Depth of the subagent itself = parent depth + 1; parent depth comes from the
      // launcher message's own depth (if it's a sidechain message of another subagent).
      if (isNew) {
        const launcherDepth = messageDepthByIndex.get(index) ?? 0;
        subagentDepth.set(id, launcherDepth + 1);
      }

      addMessageToSubagent(subagent, message, index, { countMessage: false });
    }

    for (const resultBlock of getToolResultBlocks(message)) {
      const launcherSubagentId = toolUseToSubagentId.get(String(resultBlock.tool_use_id));
      if (launcherSubagentId) {
        const subagent = subagentsById.get(launcherSubagentId)!;
        const agentId = extractAgentIdFromResult(resultBlock);
        if (agentId) {
          subagent.agentId = agentId;
          agentIdToSubagentId.set(agentId, launcherSubagentId);
        }
        subagent.status = hasErrorResult(resultBlock) ? "failed" : "completed";
        subagent.lastActivity = subagent.status === "failed" ? "Error" : "Completed";
        addMessageToSubagent(subagent, message, index, { countMessage: false });
      }

      let parsedResult: any;
      const resultText = stringifyContent(resultBlock.content);
      if (resultText.trim().startsWith("{")) {
        try {
          parsedResult = JSON.parse(resultText);
        } catch {
          parsedResult = undefined;
        }
      }

      if (parsedResult) {
        applyAgentOutputResult(subagentsById, parsedResult, index, message, agentIdToSubagentId);
      }
    }

    if ((message as any).toolUseResult?.agents) {
      applyAgentOutputResult(subagentsById, (message as any).toolUseResult, index, message, agentIdToSubagentId);
    }

    if (isLauncherToolResultMessage(message, toolUseToSubagentId)) {
      subagentMessageIndexes.add(index);
    }

    if (isSubagentEnvelopeMessage(message)) {
      const parentToolUseId =
        (message as any).parent_tool_use_id ??
        (message as any).parentToolUseID ??
        (message as any).parentToolUseId;
      if (parentToolUseId) {
        const subagentId = toolUseToSubagentId.get(String(parentToolUseId));
        if (subagentId) {
          const subagent = subagentsById.get(subagentId)!;
          addMessageToSubagent(subagent, message, index);
          assignToSubagent(subagentId, index);
        } else {
          // Unknown launcher — keep the message-filter envelope fallback active by
          // hiding it. Once the launcher arrives the user can re-run / scroll to see it.
          subagentMessageIndexes.add(index);
        }
      }
    }

    const agentId = normalizeAgentId(String(message.agentId || message.agent_id || ""));
    if (agentId && agentIdToSubagentId.has(agentId)) {
      const subagentId = agentIdToSubagentId.get(agentId)!;
      const subagent = subagentsById.get(subagentId)!;
      addMessageToSubagent(subagent, message, index);
      assignToSubagent(subagentId, index);
    }
  });

  for (const [rawAgentId, transcript] of Object.entries(subagentTranscripts)) {
    const agentId = normalizeAgentId(rawAgentId);
    const matchedByAgentId = agentIdToSubagentId.get(agentId);
    const matchedByPrompt = !matchedByAgentId
      ? Array.from(subagentsById.values()).find((subagent) => promptsMatch(subagent.prompt, extractTranscriptPrompt(transcript)))?.id
      : undefined;
    const subagentId = matchedByAgentId ?? matchedByPrompt ?? agentId;
    const subagent = subagentsById.get(subagentId);
    if (!subagent || transcript.length === 0) continue;

    subagent.agentId = agentId;
    subagent.messages = transcript;
    subagent.messageCount = transcript.length;
    subagent.toolUseCount = Math.max(subagent.toolUseCount, transcriptToolUseCount(transcript));
    subagent.tokenCount = Math.max(subagent.tokenCount, transcriptTokenCount(transcript));
    subagent.lastActivity = transcriptLastActivity(transcript) ?? subagent.lastActivity;
  }

  const subagents = Array.from(subagentsById.values())
    .filter((subagent) => subagent.launcherToolUseId || subagent.agentId || subagent.toolUseCount > 0)
    .map((subagent) => ({
      ...subagent,
      status: subagent.status === "unknown" ? "running" : subagent.status,
    }))
    .sort((a, b) => Math.min(...a.messageIndexes) - Math.min(...b.messageIndexes));

  if (subagents.length === 0) {
    return {
      subagents: [],
      rootMessages: messages,
      rootMessageIndexes: new Set(messages.map((_, index) => index)),
      subagentMessageIndexes: new Set(),
      messageDepthByIndex: new Map(),
      totalToolUseCount: 0,
      totalTokenCount: 0,
      runningCount: 0,
      completedCount: 0,
      failedCount: 0,
    };
  }

  const rootMessages = messages.filter((_, index) => !subagentMessageIndexes.has(index));
  const rootMessageIndexes = new Set<number>();
  messages.forEach((_, index) => {
    if (!subagentMessageIndexes.has(index)) rootMessageIndexes.add(index);
  });

  return {
    subagents,
    rootMessages,
    rootMessageIndexes,
    subagentMessageIndexes,
    messageDepthByIndex,
    totalToolUseCount: subagents.reduce((sum, subagent) => sum + subagent.toolUseCount, 0),
    totalTokenCount: subagents.reduce((sum, subagent) => sum + subagent.tokenCount, 0),
    runningCount: subagents.filter((subagent) => subagent.status === "running").length,
    completedCount: subagents.filter((subagent) => subagent.status === "completed").length,
    failedCount: subagents.filter((subagent) => subagent.status === "failed").length,
  };
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toString();
}
