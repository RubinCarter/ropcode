import React, { useMemo, useState } from "react";
import { 
  CheckCircle2, 
  Circle, 
  Clock,
  FolderOpen,
  FileText,
  Search,
  Terminal,
  FileEdit,
  Code,
  ChevronRight,
  Maximize2,
  GitBranch,
  X,
  Info,
  AlertCircle,
  Settings,
  Fingerprint,
  Cpu,
  FolderSearch,
  List,
  LogOut,
  Edit3,
  FilePlus,
  Book,
  BookOpen,
  Globe,
  ListChecks,
  ListPlus,
  Globe2,
  Package,
  ChevronDown,
  Package2,
  Wrench,
  CheckSquare,
  type LucideIcon,
  Sparkles,
  Bot,
  Zap,
  FileCode,
  Folder,
  ChevronUp,
  BarChart3,
  Download,
  LayoutGrid,
  LayoutList,
  Activity,
  Hash,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/hooks";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import * as Diff from 'diff';
import { Card, CardContent } from "@/components/ui/card";
import { detectLinks, makeLinksClickable } from "@/lib/linkDetector";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { open } from "@/lib/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { pathSegments, shortenPath } from "@/lib/pathUtils";
import type { ClaudeStreamMessage } from "../AgentExecution";

export interface ControlledExpansionProps {
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

const systemToolIcons: Record<string, LucideIcon> = {
  task: CheckSquare,
  bash: Terminal,
  glob: FolderSearch,
  grep: Search,
  ls: List,
  exit_plan_mode: LogOut,
  read: FileText,
  edit: Edit3,
  multiedit: Edit3,
  write: FilePlus,
  notebookread: Book,
  notebookedit: BookOpen,
  webfetch: Globe,
  todoread: ListChecks,
  todowrite: ListPlus,
  websearch: Globe2,
};

function titleCaseWords(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getSystemToolIcon(toolName: string) {
  return systemToolIcons[toolName.toLowerCase()] || Wrench;
}

function formatMcpToolName(toolName: string) {
  const withoutPrefix = toolName.replace(/^mcp__/, '');
  const parts = withoutPrefix.split('__');
  if (parts.length >= 2) {
    return {
      provider: titleCaseWords(parts[0]),
      method: titleCaseWords(parts.slice(1).join('__')),
    };
  }
  return {
    provider: 'MCP',
    method: titleCaseWords(withoutPrefix),
  };
}

function useControlledExpansion({ defaultExpanded = false, expanded: controlledExpanded, onExpandedChange }: ControlledExpansionProps = {}) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const setExpanded = (nextExpanded: boolean) => {
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };
  return [expanded, setExpanded] as const;
}

/**
 * Widget for TodoWrite tool - displays a beautiful TODO list
 */

export const TaskWidget: React.FC<{
  description?: string;
  prompt?: string;
  result?: any;
  toolUseId?: string;
  allMessages?: ClaudeStreamMessage[];
  agentOutputMap?: Map<string, any>;
} & ControlledExpansionProps> = ({ description, prompt, result, toolUseId: _toolUseId, allMessages: _allMessages = [], agentOutputMap, ...expansionProps }) => {
  const [isExpanded, setIsExpanded] = useControlledExpansion(expansionProps);
  const [isResultExpanded, setIsResultExpanded] = useState(false);

  // Extract agentId from result text (e.g., "agentId: af436c78")
  let agentId: string | undefined;
  if (result?.content?.[0]?.text) {
    const match = result.content[0].text.match(/agentId:\s*([a-f0-9]+)/);
    if (match) {
      agentId = match[1];
    }
  }

  // Get subagent status from agentOutputMap
  // agentOutputMap now stores toolUseResult directly (with agents.{agentId}.status)
  let subagentStatus = 'Running';
  let subagentResult = null;

  if (agentId && agentOutputMap) {
    const toolUseResult = agentOutputMap.get(agentId);

    if (toolUseResult?.agents?.[agentId]) {
      const agentData = toolUseResult.agents[agentId];

      if (agentData.status === 'completed') {
        subagentStatus = 'Completed';
        subagentResult = agentData.result;
      } else if (agentData.status === 'error') {
        subagentStatus = 'Error';
        subagentResult = agentData.error;
      }
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative">
          <Bot className="h-4 w-4 text-purple-500" />
          <Sparkles className="h-2.5 w-2.5 text-purple-400 absolute -top-1 -right-1" />
        </div>
        <span className="text-sm font-medium">Spawning Sub-Agent Task</span>

        {/* Status badge */}
        <span className={cn(
          "px-2 py-0.5 text-xs font-medium rounded-full",
          subagentStatus === 'Completed' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
          subagentStatus === 'Running' && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
          subagentStatus === 'Error' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        )}>
          {subagentStatus}
        </span>
      </div>

      <div className="ml-6 space-y-3">
        {description && (
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Task Description</span>
            </div>
            <p className="text-sm text-foreground ml-5">{description}</p>
          </div>
        )}

        {prompt && (
          <div className="space-y-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
              <span>Task Instructions</span>
            </button>

            {isExpanded && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {prompt}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Display subagent result when completed */}
        {subagentResult && (
          <div className="space-y-2">
            <button
              onClick={() => setIsResultExpanded(!isResultExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", isResultExpanded && "rotate-90")} />
              <span>Subagent Result</span>
            </button>

            {isResultExpanded && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {typeof subagentResult === 'string' ? subagentResult : JSON.stringify(subagentResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Widget for WebSearch tool - displays web search query and results
 */
