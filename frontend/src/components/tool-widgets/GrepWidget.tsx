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

export const GrepWidget: React.FC<{
  pattern: string;
  include?: string;
  path?: string;
  exclude?: string;
  result?: any;
} & ControlledExpansionProps> = ({ pattern, include, path, exclude, result, ...expansionProps }) => {
  const [isExpanded, setIsExpanded] = useControlledExpansion(expansionProps);
  
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
  
  // Parse grep results to extract file paths and matches
  const parseGrepResults = (content: string) => {
    const lines = content.split('\n').filter(line => line.trim());
    const results: Array<{
      file: string;
      lineNumber: number;
      content: string;
    }> = [];
    
    lines.forEach(line => {
      // Common grep output format: filename:lineNumber:content
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          lineNumber: parseInt(match[2], 10),
          content: match[3]
        });
      }
    });
    
    return results;
  };
  
  const grepResults = result && !isError ? parseGrepResults(resultContent) : [];
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
        <Search className="h-4 w-4 text-emerald-500" />
        <span className="text-sm font-medium">Searching with grep</span>
        {!result && (
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <div className="h-2 w-2 bg-emerald-500 rounded-full" />
            <span>Searching...</span>
          </div>
        )}
      </div>
      
      {/* Search Parameters */}
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <div className="grid gap-2">
          {/* Pattern with regex highlighting */}
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-1.5 min-w-[80px]">
              <Code className="h-3 w-3 text-emerald-500" />
              <span className="text-xs font-medium text-muted-foreground">Pattern</span>
            </div>
            <code className="flex-1 font-mono text-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-md text-emerald-600 dark:text-emerald-400">
              {pattern}
            </code>
          </div>
          
          {/* Path */}
          {path && (
            <div className="flex items-start gap-3">
              <div className="flex items-center gap-1.5 min-w-[80px]">
                <FolderOpen className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Path</span>
              </div>
              <code className="flex-1 font-mono text-xs bg-muted px-2 py-1 rounded truncate" title={path}>
                {shortenPath(path)}
              </code>
            </div>
          )}
          
          {/* Include/Exclude patterns in a row */}
          {(include || exclude) && (
            <div className="flex gap-4">
              {include && (
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex items-center gap-1.5">
                    <FilePlus className="h-3 w-3 text-green-500" />
                    <span className="text-xs font-medium text-muted-foreground">Include</span>
                  </div>
                  <code className="font-mono text-xs bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded text-green-600 dark:text-green-400">
                    {include}
                  </code>
                </div>
              )}
              
              {exclude && (
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex items-center gap-1.5">
                    <X className="h-3 w-3 text-red-500" />
                    <span className="text-xs font-medium text-muted-foreground">Exclude</span>
                  </div>
                  <code className="font-mono text-xs bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded text-red-600 dark:text-red-400">
                    {exclude}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Results */}
      {result && (
        <div className="space-y-2">
          {isError ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="text-sm text-red-600 dark:text-red-400">
                {resultContent || "Search failed"}
              </div>
            </div>
          ) : grepResults.length > 0 ? (
            <>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>{grepResults.length} matches found</span>
              </button>
              
              {isExpanded && (
                <div className="rounded-lg border bg-background overflow-hidden">
                  <div className="max-h-[400px] overflow-y-auto">
                    {grepResults.map((match, idx) => {
                      const shortenedPath = shortenPath(match.file);

                      return (
                        <div
                          key={idx}
                          className={cn(
                            "flex items-start gap-3 p-3 border-b border-border hover:bg-muted/50 transition-colors",
                            idx === grepResults.length - 1 && "border-b-0"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-[60px]">
                            <FileText className="h-3.5 w-3.5 text-emerald-500" />
                            <span className="text-xs font-mono text-emerald-400">
                              {match.lineNumber}
                            </span>
                          </div>

                          <div className="flex-1 space-y-1 min-w-0">
                            <div className="flex items-center gap-2" title={match.file}>
                              <span className="text-xs font-medium text-blue-400 truncate">
                                {shortenedPath}
                              </span>
                            </div>
                            <code className="text-xs font-mono text-zinc-300 block whitespace-pre-wrap break-all">
                              {match.content.trim()}
                            </code>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Info className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div className="text-sm text-amber-600 dark:text-amber-400">
                No matches found for the given pattern.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};



/**
 * Widget for Edit tool - shows the edit operation
 */
