import React from "react";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EditResultWidget,
  LSResultWidget,
  MultiEditResultWidget,
  ReadResultWidget,
  SystemReminderWidget,
} from "../tool-widgets";
import type { GetCardExpansionProps, StreamMessageContext } from "./context";
import { stringifyMessageValue } from "./contentText";
import { useTranslation } from 'react-i18next';

interface RenderToolResultContentOptions {
  content: any;
  index: number;
  streamContext: StreamMessageContext;
  getCardExpansionProps: GetCardExpansionProps;
}

const toolsWithDedicatedWidgets = [
  'task',
  'edit',
  'multiedit',
  'todowrite',
  'todoread',
  'ls',
  'read',
  'glob',
  'bash',
  'write',
  'grep',
  'websearch',
  'web_search',
  'webfetch',
  'agentoutputtool',
];

export function renderToolResultContent({
  content,
  index,
  streamContext,
  getCardExpansionProps,
}: RenderToolResultContentOptions): React.ReactNode {
  if (content.type !== "tool_result") {
    return null;
  }

  if (hasCorrespondingWidget(content, streamContext)) {
    return null;
  }

  const contentText = stringifyMessageValue(content.content);
  const reminderMatch = contentText.match(/<system-reminder>(.*?)<\/system-reminder>/s);
  if (reminderMatch) {
    const reminderMessage = reminderMatch[1].trim();
    const beforeReminder = contentText.substring(0, reminderMatch.index || 0).trim();
    const afterReminder = contentText.substring((reminderMatch.index || 0) + reminderMatch[0].length).trim();

    return (
      <div className="space-y-2">
        <ToolResultHeader />
        {beforeReminder && <ToolResultPre>{beforeReminder}</ToolResultPre>}
        <div className="ml-6">
          <SystemReminderWidget message={reminderMessage} />
        </div>
        {afterReminder && <ToolResultPre>{afterReminder}</ToolResultPre>}
      </div>
    );
  }

  if (contentText.includes("has been updated. Here's the result of running `cat -n`")) {
    return (
      <div className="space-y-2">
        <ToolResultHeader label="Edit Result" />
        <EditResultWidget content={contentText} {...getCardExpansionProps(`tool-result-${content.tool_use_id || index}-edit`, false)} />
      </div>
    );
  }

  const isMultiEditResult = contentText.includes("has been updated with multiple edits") ||
    contentText.includes("MultiEdit completed successfully") ||
    contentText.includes("Applied multiple edits to");
  if (isMultiEditResult) {
    return (
      <div className="space-y-2">
        <ToolResultHeader label="MultiEdit Result" />
        <MultiEditResultWidget content={contentText} />
      </div>
    );
  }

  if (isLSResult(content, contentText, streamContext)) {
    return (
      <div className="space-y-2">
        <ToolResultHeader label="Directory Contents" />
        <LSResultWidget content={contentText} />
      </div>
    );
  }

  if (content.tool_use_id && /^\s*\d+->/.test(contentText.replace(/→/g, '->'))) {
    const filePath = streamContext.readToolPathsById.get(content.tool_use_id);
    return (
      <div className="space-y-2">
        <ToolResultHeader label="Read Result" />
        <ReadResultWidget content={contentText} filePath={filePath} workspacePath={streamContext.cwd} {...getCardExpansionProps(`tool-result-${content.tool_use_id || index}-read`, false)} />
      </div>
    );
  }

  if (!contentText || contentText.trim() === '') {
    return (
      <div className="space-y-2">
        <ToolResultHeader />
        <div className="ml-6 p-3 bg-muted/50 rounded-md border text-sm text-muted-foreground italic">
          (no output)
        </div>
      </div>
    );
  }

  const toolResultExpansion = getCardExpansionProps(`tool-result-${content.tool_use_id || index}`, false);
  const isExpanded = Boolean(toolResultExpansion.expanded);

  return (
    <ExpandableToolResult
      isError={content.is_error}
      isExpanded={isExpanded}
      onToggle={() => toolResultExpansion.onExpandedChange?.(!isExpanded)}
      contentText={contentText}
    />
  );
}

interface ExpandableToolResultProps {
  isError: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  contentText: string;
}

function ExpandableToolResult({ isError, isExpanded, onToggle, contentText }: ExpandableToolResultProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
      >
        {isError ? (
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
        )}
        <span className="text-sm font-medium">{t('stream.toolResult')}</span>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform ml-auto flex-shrink-0",
          isExpanded && "rotate-180"
        )} />
      </button>

      {isExpanded && (
        <div className="p-3 rounded-lg border bg-card/50">
          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {contentText}
          </pre>
        </div>
      )}
    </div>
  );
}

function hasCorrespondingWidget(content: any, streamContext: StreamMessageContext): boolean {
  if (!content.tool_use_id) {
    return false;
  }
  const toolName = streamContext.toolUseNamesById.get(content.tool_use_id);
  return Boolean(toolName && (toolsWithDedicatedWidgets.includes(toolName) || toolName.startsWith('mcp__')));
}

function isLSResult(content: any, contentText: string, streamContext: StreamMessageContext): boolean {
  if (!content.tool_use_id || typeof contentText !== 'string') return false;
  if (streamContext.toolUseNamesById.get(content.tool_use_id) !== 'ls') return false;

  const lines = contentText.split('\n');
  const hasTreeStructure = lines.some(line => /^\s*-\s+/.test(line));
  const hasNoteAtEnd = lines.some(line => line.trim().startsWith('NOTE: do any of the files'));

  return hasTreeStructure || hasNoteAtEnd;
}

function ToolResultHeader({ label = "Tool Result" }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-green-500" />
      <span className="text-sm font-medium">{label || t('stream.toolResult')}</span>
    </div>
  );
}

function ToolResultPre({ children }: { children: string }) {
  return (
    <div className="ml-6 p-2 bg-background rounded-md border">
      <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}
