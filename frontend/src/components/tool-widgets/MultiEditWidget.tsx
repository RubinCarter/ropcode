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

const getLanguage = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    sql: "sql",
    md: "markdown",
    toml: "ini",
    ini: "ini",
    dockerfile: "dockerfile",
    makefile: "makefile"
  };
  return languageMap[ext || ""] || "text";
};

export const MultiEditWidget: React.FC<{
  file_path: string;
  edits: Array<{ old_string: string; new_string: string }>;
  result?: any;
} & ControlledExpansionProps> = ({ file_path, edits, result: _result, ...expansionProps }) => {
  const [isExpanded, setIsExpanded] = useControlledExpansion(expansionProps);
  const language = getLanguage(file_path);
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);

  // Shorten the file path for display
  const displayPath = shortenPath(file_path);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <FileEdit className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Using tool: MultiEdit</span>
      </div>
      <div className="ml-6 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-blue-500" />
          <code className="text-xs font-mono text-blue-500" title={file_path}>{displayPath}</code>
        </div>
        
        <div className="space-y-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
            {edits.length} edit{edits.length !== 1 ? 's' : ''}
          </button>
          
          {isExpanded && (
            <div className="space-y-3 mt-3">
              {edits.map((edit, index) => {
                const diffResult = Diff.diffLines(edit.old_string || '', edit.new_string || '', { 
                  newlineIsToken: true,
                  ignoreWhitespace: false 
                });
                
                return (
                  <div key={index} className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Edit {index + 1}</div>
                    <div className="rounded-lg border bg-background overflow-hidden text-xs font-mono">
                      <div className="max-h-[300px] overflow-y-auto overflow-x-auto">
                        {diffResult.map((part, partIndex) => {
                          const partClass = part.added 
                            ? 'bg-green-950/20' 
                            : part.removed 
                            ? 'bg-red-950/20'
                            : '';
                          
                          if (!part.added && !part.removed && part.count && part.count > 8) {
                            return (
                              <div key={partIndex} className="px-4 py-1 bg-muted border-y border-border text-center text-muted-foreground text-xs">
                                ... {part.count} unchanged lines ...
                              </div>
                            );
                          }
                          
                          const value = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;

                          return (
                            <div key={partIndex} className={cn(partClass, "flex")}>
                              <div className="w-8 select-none text-center flex-shrink-0">
                                {part.added ? <span className="text-green-400">+</span> : part.removed ? <span className="text-red-400">-</span> : null}
                              </div>
                              <div className="flex-1">
                                <SyntaxHighlighter
                                  language={language}
                                  style={syntaxTheme}
                                  PreTag="div"
                                  wrapLongLines={false}
                                  customStyle={{
                                    margin: 0,
                                    padding: 0,
                                    background: 'transparent',
                                  }}
                                  codeTagProps={{
                                    style: {
                                      fontSize: '0.75rem',
                                      lineHeight: '1.6',
                                    }
                                  }}
                                >
                                  {value}
                                </SyntaxHighlighter>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Widget for displaying MultiEdit tool results with diffs
 */

export const MultiEditResultWidget: React.FC<{ 
  content: string;
  edits?: Array<{ old_string: string; new_string: string }>;
}> = ({ content, edits }) => {
  // If we have the edits array, show a nice diff view
  if (edits && edits.length > 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 rounded-t-md border-b border-green-500/20">
          <GitBranch className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium text-green-600 dark:text-green-400">
            {edits.length} Changes Applied
          </span>
        </div>
        
        <div className="space-y-4">
          {edits.map((edit, index) => {
            // Split the strings into lines for diff display
            const oldLines = edit.old_string.split('\n');
            const newLines = edit.new_string.split('\n');
            
            return (
              <div key={index} className="border border-border/50 rounded-md overflow-hidden">
                <div className="px-3 py-1 bg-muted/50 border-b border-border/50">
                  <span className="text-xs font-medium text-muted-foreground">Change {index + 1}</span>
                </div>
                
                <div className="font-mono text-xs">
                  {/* Show removed lines */}
                  {oldLines.map((line, lineIndex) => (
                    <div
                      key={`old-${lineIndex}`}
                      className="flex bg-red-500/10 border-l-4 border-red-500"
                    >
                      <span className="w-12 px-2 py-1 text-red-600 dark:text-red-400 select-none text-right bg-red-500/10">
                        -{lineIndex + 1}
                      </span>
                      <pre className="flex-1 px-3 py-1 text-red-700 dark:text-red-300 overflow-x-auto">
                        <code>{line || ' '}</code>
                      </pre>
                    </div>
                  ))}
                  
                  {/* Show added lines */}
                  {newLines.map((line, lineIndex) => (
                    <div
                      key={`new-${lineIndex}`}
                      className="flex bg-green-500/10 border-l-4 border-green-500"
                    >
                      <span className="w-12 px-2 py-1 text-green-600 dark:text-green-400 select-none text-right bg-green-500/10">
                        +{lineIndex + 1}
                      </span>
                      <pre className="flex-1 px-3 py-1 text-green-700 dark:text-green-300 overflow-x-auto">
                        <code>{line || ' '}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  
  // Fallback to simple content display
  return (
    <div className="p-3 bg-muted/50 rounded-md border">
      <pre className="text-xs font-mono whitespace-pre-wrap">{content}</pre>
    </div>
  );
};

/**
 * Widget for displaying system reminders (instead of raw XML)
 */
