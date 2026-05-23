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

export const TodoWidget: React.FC<{ todos: any[]; result?: any } & ControlledExpansionProps> = ({ todos, result: _result, ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);

  const statusIcons = {
    completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    in_progress: <Clock className="h-4 w-4 text-blue-500" />,
    pending: <Circle className="h-4 w-4 text-muted-foreground" />
  };

  const priorityColors = {
    high: "bg-red-500/10 text-red-500 border-red-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    low: "bg-green-500/10 text-green-500 border-green-500/20"
  };

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
      >
        <FileEdit className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">Todo List</span>
        <span className="text-xs text-muted-foreground">({todos.length} items)</span>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform ml-auto flex-shrink-0",
          expanded && "rotate-180"
        )} />
      </button>

      {expanded && (
        <div className="space-y-2">
          {todos.map((todo, idx) => (
            <div
              key={todo.id || idx}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border bg-card/50",
                todo.status === "completed" && "opacity-60"
              )}
            >
              <div className="mt-0.5">
                {statusIcons[todo.status as keyof typeof statusIcons] || statusIcons.pending}
              </div>
              <div className="flex-1 space-y-1">
                <p className={cn(
                  "text-sm",
                  todo.status === "completed" && "line-through"
                )}>
                  {todo.content}
                </p>
                {todo.priority && (
                  <Badge
                    variant="outline"
                    className={cn("text-xs", priorityColors[todo.priority as keyof typeof priorityColors])}
                  >
                    {todo.priority}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Widget for LS (List Directory) tool
 */
