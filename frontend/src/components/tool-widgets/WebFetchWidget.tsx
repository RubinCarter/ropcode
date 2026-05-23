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

export const WebFetchWidget: React.FC<{
  url: string;
  prompt?: string;
  result?: any;
} & ControlledExpansionProps> = ({ url, prompt, result, ...expansionProps }) => {
  const [isExpanded, setIsExpanded] = useControlledExpansion(expansionProps);
  const [showFullContent, setShowFullContent] = useState(false);

  // Extract result content if available
  let fetchedContent = '';
  let isLoading = !result;
  let hasError = false;

  if (result) {
    if (typeof result.content === 'string') {
      fetchedContent = result.content;
    } else if (result.content && typeof result.content === 'object') {
      if (result.content.text) {
        fetchedContent = result.content.text;
      } else if (Array.isArray(result.content)) {
        fetchedContent = result.content
          .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
          .join('\n');
      } else {
        fetchedContent = JSON.stringify(result.content, null, 2);
      }
    }

    // Check if there's an error
    hasError = result.is_error ||
               fetchedContent.toLowerCase().includes('error') ||
               fetchedContent.toLowerCase().includes('failed');
  }

  // Truncate content for preview
  const maxPreviewLength = 500;
  const isTruncated = fetchedContent.length > maxPreviewLength;
  const previewContent = isTruncated && !showFullContent
    ? fetchedContent.substring(0, maxPreviewLength) + '...'
    : fetchedContent;

  // Extract domain from URL for display
  const getDomain = (urlString: string) => {
    try {
      const urlObj = new URL(urlString);
      return urlObj.hostname;
    } catch {
      return urlString;
    }
  };

  const handleUrlClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await open(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  };

  // Content length indicator
  const contentLength = fetchedContent.length;
  const contentSizeLabel = contentLength > 1000
    ? `${Math.round(contentLength / 1000)}k chars`
    : contentLength > 0
    ? `${contentLength} chars`
    : '';

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      {/* Clickable Header */}
      <button
        onClick={() => !isLoading && setIsExpanded(!isExpanded)}
        disabled={isLoading}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-purple-500/10 transition-colors disabled:cursor-default"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe className="h-4 w-4 text-purple-500/70 flex-shrink-0" />
          <span className="text-xs font-medium uppercase tracking-wider text-purple-600/70 dark:text-purple-400/70 flex-shrink-0">
            Fetching
          </span>
          <span
            onClick={handleUrlClick}
            className="text-sm text-muted-foreground/80 truncate hover:underline decoration-purple-500/50 cursor-pointer"
          >
            {getDomain(url)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <div className="h-1 w-1 bg-purple-500 rounded-full [animation-delay:-0.3s]"></div>
              <div className="h-1 w-1 bg-purple-500 rounded-full [animation-delay:-0.15s]"></div>
              <div className="h-1 w-1 bg-purple-500 rounded-full"></div>
            </div>
          ) : hasError ? (
            <span className="text-xs text-destructive">Error</span>
          ) : contentSizeLabel ? (
            <span className="text-xs text-muted-foreground">{contentSizeLabel}</span>
          ) : (
            <span className="text-xs text-muted-foreground">No content</span>
          )}
          {!isLoading && (
            <ChevronRight className={cn(
              "h-4 w-4 text-purple-500/50 transition-transform",
              isExpanded && "rotate-90"
            )} />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && !isLoading && (
        <div className="border-t border-purple-500/20">
          {/* Prompt Display */}
          {prompt && (
            <div className="px-3 py-2 border-b border-purple-500/10 bg-purple-500/5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Info className="h-3 w-3" />
                <span>Analysis Prompt</span>
              </div>
              <p className="text-sm text-foreground/90 ml-4">
                {prompt}
              </p>
            </div>
          )}

          {/* Fetched Content */}
          {hasError ? (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Failed to fetch content</span>
              </div>
              <pre className="mt-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                {fetchedContent}
              </pre>
            </div>
          ) : fetchedContent ? (
            <div className="p-3 space-y-2">
              {/* Content Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Content from {getDomain(url)}</span>
                </div>
                {isTruncated && (
                  <button
                    onClick={() => setShowFullContent(!showFullContent)}
                    className="text-xs text-purple-500 hover:text-purple-600 transition-colors flex items-center gap-1"
                  >
                    {showFullContent ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        Show full content
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Fetched Content */}
              <div className="relative">
                <div className={cn(
                  "rounded-lg bg-muted/30 p-3 overflow-hidden",
                  !showFullContent && isTruncated && "max-h-[300px]"
                )}>
                  <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">
                    {previewContent}
                  </pre>
                  {!showFullContent && isTruncated && (
                    <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-muted/30 to-transparent pointer-events-none" />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Info className="h-4 w-4" />
                <span className="text-sm">No content returned</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Widget for TodoRead tool - displays todos with advanced viewing capabilities
 */
