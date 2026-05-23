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

export const SystemInitializedWidget: React.FC<{
  sessionId?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
} & ControlledExpansionProps> = ({ sessionId, model, cwd, tools = [], ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);
  const [mcpExpanded, setMcpExpanded] = useState(false);

  const { regularTools, mcpTools } = useMemo(() => {
    const regularTools: string[] = [];
    const mcpTools: string[] = [];
    for (const tool of tools) {
      if (tool.startsWith('mcp__')) {
        mcpTools.push(tool);
      } else {
        regularTools.push(tool);
      }
    }
    return { regularTools, mcpTools };
  }, [tools]);

  const mcpToolsByProvider = useMemo(() => {
    if (!expanded || !mcpExpanded) return {} as Record<string, string[]>;
    return mcpTools.reduce((acc, tool) => {
      const { provider } = formatMcpToolName(tool);
      if (!acc[provider]) {
        acc[provider] = [];
      }
      acc[provider].push(tool);
      return acc;
    }, {} as Record<string, string[]>);
  }, [expanded, mcpExpanded, mcpTools]);
  
  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardContent className="p-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-start gap-3 text-left hover:opacity-80 transition-opacity"
        >
          <Settings className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">System Initialized</h4>
          </div>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-0.5",
            expanded && "rotate-180"
          )} />
        </button>

        {expanded && (
          <div className="ml-8 mt-4 space-y-4">
            {/* Session Info */}
            <div className="space-y-2">
              {sessionId && (
                <div className="flex items-center gap-2 text-xs">
                  <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Session ID:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {sessionId}
                  </code>
                </div>
              )}
              
              {model && (
                <div className="flex items-center gap-2 text-xs">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Model:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {model}
                  </code>
                </div>
              )}
              
              {cwd && (
                <div className="flex items-center gap-2 text-xs">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Working Directory:</span>
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded break-all">
                    {cwd}
                  </code>
                </div>
              )}
            </div>
            
            {/* Regular Tools */}
            {regularTools.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Available Tools ({regularTools.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {regularTools.map((tool, idx) => {
                    const Icon = getSystemToolIcon(tool);
                    return (
                      <Badge 
                        key={idx} 
                        variant="secondary" 
                        className="text-xs py-0.5 px-2 flex items-center gap-1"
                      >
                        <Icon className="h-3 w-3" />
                        {tool}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* MCP Tools */}
            {mcpTools.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setMcpExpanded(!mcpExpanded)}
                  className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>MCP Services ({mcpTools.length})</span>
                  <ChevronDown className={cn(
                    "h-3 w-3 transition-transform",
                    mcpExpanded && "rotate-180"
                  )} />
                </button>
                
                {mcpExpanded && (
                  <div className="ml-5 space-y-3">
                    {Object.entries(mcpToolsByProvider).map(([provider, providerTools]) => (
                      <div key={provider} className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Package2 className="h-3 w-3" />
                          <span className="font-medium">{provider}</span>
                          <span className="text-muted-foreground/60">({providerTools.length})</span>
                        </div>
                        <div className="ml-4 flex flex-wrap gap-1">
                          {providerTools.map((tool, idx) => {
                            const { method } = formatMcpToolName(tool);
                            return (
                              <Badge 
                                key={idx} 
                                variant="outline" 
                                className="text-xs py-0 px-1.5 font-normal"
                              >
                                {method}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Show message if no tools */}
            {tools.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No tools available
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Widget for Task tool - displays sub-agent task information
 */
