import React from "react";
import { Terminal } from "lucide-react";
import i18n from '@/lib/i18n';
import type { ClaudeStreamMessage } from "../AgentExecution";
import {
  TodoWidget,
  TodoReadWidget,
  LSWidget,
  ReadWidget,
  GlobWidget,
  BashWidget,
  WriteWidget,
  GrepWidget,
  EditWidget,
  MCPWidget,
  MultiEditWidget,
  TaskWidget,
  WebSearchWidget,
  WebFetchWidget,
} from "../tool-widgets";
import type { GetCardExpansionProps, StreamMessageContext } from "./context";

interface RenderToolUseContentOptions {
  content: any;
  index: number;
  streamMessages?: ClaudeStreamMessage[];
  streamContext: StreamMessageContext;
  agentOutputMap?: Map<string, any>;
  getCardExpansionProps: GetCardExpansionProps;
}

export function renderToolUseContent({
  content,
  index,
  streamMessages,
  streamContext,
  agentOutputMap,
  getCardExpansionProps,
}: RenderToolUseContentOptions): React.ReactNode {
  if (content.type !== "tool_use" && content.type !== "server_tool_use") {
    return null;
  }

  const toolName = content.name?.toLowerCase();
  const input = content.input;
  const toolId = content.id;
  const toolCardKey = `tool-${toolName || 'unknown'}-${toolId || index}`;
  const toolResult = toolId ? streamContext.toolResults.get(toolId) || null : null;
  const cwd = streamContext.cwd;

  if ((toolName === "task" || toolName === "agent" || toolName === "agenttool") && input) {
    return (
      <TaskWidget
        description={input.description}
        prompt={input.prompt}
        result={toolResult}
        toolUseId={toolId}
        allMessages={streamMessages}
        agentOutputMap={agentOutputMap}
        {...getCardExpansionProps(`${toolCardKey}-task-instructions`, false)}
      />
    );
  }

  if (toolName === "edit" && input?.file_path) {
    return <EditWidget {...input} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "multiedit" && input?.file_path && input?.edits) {
    return <MultiEditWidget {...input} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (content.name?.startsWith("mcp__")) {
    return <MCPWidget toolName={content.name} input={input} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "todowrite" && input?.todos) {
    return <TodoWidget todos={input.todos} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "todoread") {
    return <TodoReadWidget todos={input?.todos} result={toolResult} />;
  }

  if (toolName === "ls" && input?.path) {
    return <LSWidget path={input.path} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "read" && input?.file_path) {
    return <ReadWidget filePath={input.file_path} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "glob" && input?.pattern) {
    return <GlobWidget pattern={input.pattern} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "bash" && input?.command) {
    return <BashWidget command={input.command} description={input.description} result={toolResult} cwd={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "write" && input?.file_path && input?.content) {
    return <WriteWidget filePath={input.file_path} content={input.content} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "grep" && input?.pattern) {
    return <GrepWidget pattern={input.pattern} include={input.include} path={input.path} exclude={input.exclude} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if ((toolName === "websearch" || toolName === "web_search") && input?.query) {
    return <WebSearchWidget query={input.query} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "webfetch" && input?.url) {
    return <WebFetchWidget url={input.url} prompt={input.prompt} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
  }

  if (toolName === "agentoutputtool") {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {i18n.t('stream.usingTool')} <code className="font-mono">{content.name}</code>
        </span>
      </div>
      {content.input && (
        <div className="ml-6 p-2 bg-background rounded-md border">
          <pre className="text-xs font-mono overflow-x-auto">
            {JSON.stringify(content.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
