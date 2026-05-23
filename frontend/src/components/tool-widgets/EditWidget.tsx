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

function getEditResultFilePath(content: string): string {
  const match = content.match(/The file (.+) has been updated/);
  return match?.[1] ?? '';
}

function parseEditResultContent(content: string) {
  const lines = content.split('\n');
  let filePath = '';
  const codeLines: { lineNumber: string; code: string }[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.includes('The file') && line.includes('has been updated')) {
      const match = line.match(/The file (.+) has been updated/);
      if (match) {
        filePath = match[1];
      }
    } else if (/^\s*\d+/.test(line)) {
      inCodeBlock = true;
      const lineMatch = line.match(/^\s*(\d+)\t?(.*)$/);
      if (lineMatch) {
        const [, lineNum, codePart] = lineMatch;
        codeLines.push({
          lineNumber: lineNum,
          code: codePart,
        });
      }
    } else if (inCodeBlock) {
      codeLines.push({ lineNumber: '', code: line });
    }
  }

  const codeContent = codeLines.map(l => l.code).join('\n');
  const firstNumberedLine = codeLines.find(l => l.lineNumber !== '');
  const startLineNumber = firstNumberedLine ? parseInt(firstNumberedLine.lineNumber) : 1;

  return { filePath, codeContent, startLineNumber };
}

/**
 * Widget for Edit tool result - shows a diff view
 */

export const EditWidget: React.FC<{
  file_path: string;
  old_string: string;
  new_string: string;
  result?: any;
  workspacePath?: string;
} & ControlledExpansionProps> = ({ file_path, old_string, new_string, result: _result, workspacePath, ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);

  // Shorten the file path for display
  const displayPath = shortenPath(file_path, workspacePath);

  const diffResult = useMemo(() => {
    if (!expanded) return [];
    return Diff.diffLines(old_string || '', new_string || '', {
      newlineIsToken: true,
      ignoreWhitespace: false
    });
  }, [expanded, old_string, new_string]);
  const language = getLanguage(file_path);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
      >
        <FileEdit className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">Applying Edit to:</span>
        <code className="text-sm font-mono bg-background px-2 py-0.5 rounded flex-1 truncate" title={file_path}>
          {displayPath}
        </code>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform ml-2 flex-shrink-0",
          expanded && "rotate-180"
        )} />
      </button>

      {expanded && (
        <div className="rounded-lg border bg-background overflow-hidden text-xs font-mono">
        <div className="max-h-[440px] overflow-y-auto overflow-x-auto">
          {diffResult.map((part, index) => {
            const partClass = part.added 
              ? 'bg-green-950/20' 
              : part.removed 
              ? 'bg-red-950/20'
              : '';
            
            if (!part.added && !part.removed && part.count && part.count > 8) {
              return (
                <div key={index} className="px-4 py-1 bg-muted border-y border-border text-center text-muted-foreground text-xs">
                  ... {part.count} unchanged lines ...
                </div>
              );
            }
            
            const value = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;

            return (
              <div key={index} className={cn(partClass, "flex")}>
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
      )}
    </div>
  );
};

export const EditResultWidget: React.FC<{ content: string } & ControlledExpansionProps> = ({ content, ...expansionProps }) => {
  const [isExpanded, setIsExpanded] = useControlledExpansion(expansionProps);
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);
  const collapsedFilePath = shortenPath(getEditResultFilePath(content));

  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      <div className="px-4 py-2 border-b bg-emerald-950/30 flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-mono text-emerald-400">Edit Result</span>
        {collapsedFilePath && (
          <>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-mono text-muted-foreground truncate">{collapsedFilePath}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {isExpanded ? (() => {
        const { filePath, codeContent, startLineNumber } = parseEditResultContent(content);
        const language = getLanguage(filePath);
        return (
          <div className="overflow-x-auto max-h-[440px]">
            <SyntaxHighlighter
              language={language}
              style={syntaxTheme}
              showLineNumbers
              startingLineNumber={startLineNumber}
              wrapLongLines={false}
              customStyle={{
                margin: 0,
                background: 'transparent',
                lineHeight: '1.6'
              }}
              codeTagProps={{
                style: {
                  fontSize: '0.75rem'
                }
              }}
              lineNumberStyle={{
                minWidth: "3.5rem",
                paddingRight: "1rem",
                textAlign: "right",
                opacity: 0.5,
              }}
            >
              {codeContent}
            </SyntaxHighlighter>
          </div>
        );
      })() : (
        <div className="px-4 py-3 text-xs text-muted-foreground text-center bg-muted/30">
          Click "Expand" to view the edit result
        </div>
      )}
    </div>
  );
};

/**
 * Widget for MCP (Model Context Protocol) tools
 */
