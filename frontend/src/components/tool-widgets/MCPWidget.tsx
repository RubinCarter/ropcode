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

export const MCPWidget: React.FC<{
  toolName: string;
  input?: any;
  result?: any;
} & ControlledExpansionProps> = ({ toolName, input, result, ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);
  const [isParametersExpanded, setIsParametersExpanded] = useState(false);
  const [isResultExpanded, setIsResultExpanded] = useState(false);
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);

  // Parse the tool name to extract components
  // Format: mcp__namespace__method
  const parts = toolName.split('__');
  const namespace = parts[1] || '';
  const method = parts[2] || '';

  // Format namespace for display (handle kebab-case and snake_case)
  const formatNamespace = (ns: string) => {
    return ns
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Format method name
  const formatMethod = (m: string) => {
    return m
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const hasInput = input && Object.keys(input).length > 0;
  const inputTokenSource = hasInput ? JSON.stringify(input) : '';
  const inputTokens = hasInput ? Math.ceil(inputTokenSource.length / 4) : 0;

  // Extract result content if available
  let resultContent = '';
  let isError = false;

  if (result) {
    isError = result.is_error || false;
    if (typeof result.content === 'string') {
      resultContent = result.content;
    } else if (result.content && typeof result.content === 'object') {
      if (result.content.text) {
        resultContent = result.content.text;
      } else if (Array.isArray(result.content)) {
        resultContent = result.content
          .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
          .join('\n');
      } else {
        resultContent = JSON.stringify(result.content, null, 2);
      }
    }
  }

  const isLargeResult = resultContent.length > 500;
  const isLargeInput = inputTokenSource.length > 200;
  const shouldRenderFullInput = !isLargeInput || isParametersExpanded;
  const inputString = shouldRenderFullInput ? JSON.stringify(input, null, 2) : '';

  return (
    <div className="rounded-lg border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-purple-500/5 overflow-hidden">
      {/* Header - now clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b border-violet-500/20 hover:from-violet-500/15 hover:to-purple-500/15 transition-colors text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Package2 className="h-4 w-4 text-violet-500" />
              <Sparkles className="h-2.5 w-2.5 text-violet-400 absolute -top-1 -right-1" />
            </div>
            <span className="text-sm font-medium text-violet-600 dark:text-violet-400">MCP Tool</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-mono text-purple-600 dark:text-purple-400">
              {formatNamespace(namespace)} / {formatMethod(method)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasInput && (
              <Badge
                variant="outline"
                className="text-xs border-violet-500/30 text-violet-600 dark:text-violet-400"
              >
                ~{inputTokens} tokens
              </Badge>
            )}
            <ChevronDown className={cn(
              "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
              expanded && "rotate-180"
            )} />
          </div>
        </div>
      </button>

      {/* Tool Details - only show when expanded */}
      {expanded && (
        <div className="px-4 py-3 space-y-3">
        
        {/* Input Parameters */}
        {hasInput && (
          <div className={cn(
            "transition-all duration-200",
            !isParametersExpanded && isLargeInput && "max-h-[200px]"
          )}>
            <div className="relative">
              <div className={cn(
                "rounded-lg border bg-background/50 overflow-hidden",
                !isParametersExpanded && isLargeInput && "max-h-[200px]"
              )}>
                <div className="px-3 py-2 border-b bg-muted/50 flex items-center gap-2">
                  <Code className="h-3 w-3 text-violet-500" />
                  <span className="text-xs font-mono text-muted-foreground">Parameters</span>
                </div>
                <div className={cn(
                  "overflow-auto",
                  !isParametersExpanded && isLargeInput && "max-h-[150px]"
                )}>
                  {shouldRenderFullInput ? (
                    <SyntaxHighlighter
                      language="json"
                      style={syntaxTheme}
                      customStyle={{
                        margin: 0,
                        padding: '0.75rem',
                        background: 'transparent',
                        fontSize: '0.75rem',
                        lineHeight: '1.5',
                      }}
                      wrapLongLines={false}
                    >
                      {inputString}
                    </SyntaxHighlighter>
                  ) : (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center bg-muted/30">
                      Click "Show full parameters" to view JSON parameters
                    </div>
                  )}
                </div>
              </div>

              {/* Gradient fade for collapsed view */}
              {!isParametersExpanded && isLargeInput && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
              )}
            </div>

            {/* Expand hint */}
            {!isParametersExpanded && isLargeInput && (
              <div className="text-center mt-2">
                <button
                  onClick={() => setIsParametersExpanded(true)}
                  className="text-xs text-violet-500 hover:text-violet-600 transition-colors inline-flex items-center gap-1"
                >
                  <ChevronDown className="h-3 w-3" />
                  Show full parameters
                </button>
              </div>
            )}
          </div>
        )}
        
        {/* No input message */}
        {!hasInput && (
          <div className="text-xs text-muted-foreground italic px-2">
            No parameters required
          </div>
        )}

        {/* Result section */}
        {result && (
          <div className={cn(
            "transition-all duration-200",
            !isResultExpanded && isLargeResult && "max-h-[250px]"
          )}>
            <div className="relative">
              <div className={cn(
                "rounded-lg border overflow-hidden border-border bg-muted/30",
                !isResultExpanded && isLargeResult && "max-h-[250px]"
              )}>
                <div className="px-3 py-2 border-b flex items-center gap-2 bg-muted/50 border-border">
                  {isError ? (
                    <AlertCircle className="h-3 w-3 text-red-500" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  )}
                  <span className={cn(
                    "text-xs font-mono",
                    isError ? "text-red-500" : "text-muted-foreground"
                  )}>
                    {isError ? "Error" : "Result"}
                  </span>
                </div>
                <div className={cn(
                  "overflow-auto p-3",
                  !isResultExpanded && isLargeResult && "max-h-[200px]"
                )}>
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground">
                    {resultContent || (isError ? "Command failed" : "Command completed")}
                  </pre>
                </div>
              </div>

              {/* Gradient fade for collapsed view */}
              {!isResultExpanded && isLargeResult && (
                <div className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none bg-gradient-to-t from-background/80 to-transparent" />
              )}
            </div>

            {/* Expand/collapse button for large results */}
            {isLargeResult && (
              <div className="text-center mt-2">
                <button
                  onClick={() => setIsResultExpanded(!isResultExpanded)}
                  className="text-xs transition-colors inline-flex items-center gap-1 text-violet-500 hover:text-violet-400"
                >
                  <ChevronDown className={cn(
                    "h-3 w-3 transition-transform",
                    isResultExpanded && "rotate-180"
                  )} />
                  {isResultExpanded ? "Collapse result" : "Show full result"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading indicator when no result yet */}
        {!result && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="h-2 w-2 bg-violet-500 rounded-full" />
            <span className="text-xs text-muted-foreground">Running...</span>
          </div>
        )}
        </div>
      )}
    </div>
  );
};

/**
 * Widget for user commands (e.g., model, clear)
 */
