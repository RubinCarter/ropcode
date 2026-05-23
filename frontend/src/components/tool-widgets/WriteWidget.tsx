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

export const WriteWidget: React.FC<{ filePath: string; content: string; result?: any; workspacePath?: string } & ControlledExpansionProps> = ({ filePath, content, result: _result, workspacePath, ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);
  const [isMaximized, setIsMaximized] = useState(false);
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);

  // Shorten the file path for display
  const displayPath = shortenPath(filePath, workspacePath);
  
  // Extract file extension for syntax highlighting
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

  const language = getLanguage(filePath);
  const isLargeContent = content.length > 1000;
  const displayContent = isLargeContent ? content.substring(0, 1000) + "\n..." : content;

  // Maximized view as a modal
  const MaximizedView = () => {
    if (!isMaximized) return null;
    
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop with blur */}
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsMaximized(false)}
        />
        
        {/* Modal content */}
        <div className="relative w-[90vw] h-[90vh] max-w-7xl bg-background rounded-lg border shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b bg-background flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-mono text-muted-foreground">{filePath}</span>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setIsMaximized(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Code content */}
          <div className="flex-1 overflow-auto">
            <SyntaxHighlighter
              language={language}
              style={syntaxTheme}
              customStyle={{
                margin: 0,
                padding: '1.5rem',
                background: 'transparent',
                fontSize: '0.75rem',
                lineHeight: '1.5',
                height: '100%'
              }}
              showLineNumbers
            >
              {content}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const CodePreview = ({ codeContent, truncated }: { codeContent: string; truncated: boolean }) => (
    <div 
      className="rounded-lg border bg-background overflow-hidden w-full"
      style={{ 
        height: truncated ? '440px' : 'auto', 
        maxHeight: truncated ? '440px' : undefined,
        display: 'flex', 
        flexDirection: 'column' 
      }}
    >
      <div className="px-4 py-2 border-b bg-background flex items-center justify-between sticky top-0 z-10">
        <span className="text-xs font-mono text-muted-foreground">Preview</span>
        {isLargeContent && truncated && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              Truncated to 1000 chars
            </Badge>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6"
              onClick={() => setIsMaximized(true)}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-auto flex-1">
        <SyntaxHighlighter
          language={language}
          style={syntaxTheme}
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            fontSize: '0.75rem',
            lineHeight: '1.5',
            overflowX: 'auto'
          }}
          wrapLongLines={false}
        >
          {codeContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
      >
        <FileEdit className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm">Writing to file:</span>
        <code className="text-sm font-mono bg-background px-2 py-0.5 rounded flex-1 truncate" title={filePath}>
          {displayPath}
        </code>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform ml-2 flex-shrink-0",
          expanded && "rotate-180"
        )} />
      </button>
      {expanded && (
        <>
          <CodePreview codeContent={displayContent} truncated={true} />
          <MaximizedView />
        </>
      )}
    </div>
  );
};

/**
 * Widget for Grep tool
 */
