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

export const LSWidget: React.FC<{ path: string; result?: any; workspacePath?: string } & ControlledExpansionProps> = ({ path, result, workspacePath, ...expansionProps }) => {
  const [expanded, setExpanded] = useControlledExpansion(expansionProps);

  // Shorten the path for display
  const displayPath = shortenPath(path, workspacePath);

  // If we have a result, show it using the LSResultWidget
  if (result) {
    let resultContent = '';
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

    return (
      <div className="space-y-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
        >
          <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm">Directory contents for:</span>
          <code className="text-sm font-mono bg-background px-2 py-0.5 rounded flex-1 truncate" title={path}>
            {displayPath}
          </code>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform ml-2 flex-shrink-0",
            expanded && "rotate-180"
          )} />
        </button>
        {expanded && resultContent && <LSResultWidget content={resultContent} />}
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
      <FolderOpen className="h-4 w-4 text-primary" />
      <span className="text-sm">Listing directory:</span>
      <code className="text-sm font-mono bg-background px-2 py-0.5 rounded" title={path}>
        {displayPath}
      </code>
      {!result && (
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <div className="h-2 w-2 bg-blue-500 rounded-full" />
          <span>Loading...</span>
        </div>
      )}
    </div>
  );
};

/**
 * Widget for LS tool result - displays directory tree structure
 */

export const LSResultWidget: React.FC<{ content: string }> = ({ content }) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  
  // Parse the directory tree structure
  const parseDirectoryTree = (rawContent: string) => {
    const lines = rawContent.split('\n');
    const entries: Array<{
      path: string;
      name: string;
      type: 'file' | 'directory';
      level: number;
    }> = [];
    
    let currentPath: string[] = [];
    
    for (const line of lines) {
      // Skip NOTE section and everything after it
      if (line.startsWith('NOTE:')) {
        break;
      }
      
      // Skip empty lines
      if (!line.trim()) continue;
      
      // Calculate indentation level
      const indent = line.match(/^(\s*)/)?.[1] || '';
      const level = Math.floor(indent.length / 2);
      
      // Extract the entry name
      const entryMatch = line.match(/^\s*-\s+(.+?)(\/$)?$/);
      if (!entryMatch) continue;
      
      const fullName = entryMatch[1];
      const isDirectory = line.trim().endsWith('/');
      const name = isDirectory ? fullName : fullName;
      
      // Update current path based on level
      currentPath = currentPath.slice(0, level);
      currentPath.push(name);
      
      entries.push({
        path: currentPath.join('/'),
        name,
        type: isDirectory ? 'directory' : 'file',
        level,
      });
    }
    
    return entries;
  };
  
  const entries = parseDirectoryTree(content);
  
  const toggleDirectory = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  
  // Group entries by parent for collapsible display
  const getChildren = (parentPath: string, parentLevel: number) => {
    return entries.filter(e => {
      if (e.level !== parentLevel + 1) return false;
      const parentParts = pathSegments(parentPath);
      const entryParts = pathSegments(e.path);
      
      // Check if this entry is a direct child of the parent
      if (entryParts.length !== parentParts.length + 1) return false;
      
      // Check if all parent parts match
      for (let i = 0; i < parentParts.length; i++) {
        if (parentParts[i] !== entryParts[i]) return false;
      }
      
      return true;
    });
  };
  
  const renderEntry = (entry: typeof entries[0], isRoot = false) => {
    const hasChildren = entry.type === 'directory' && 
      entries.some(e => e.path.startsWith(entry.path + '/') && e.level === entry.level + 1);
    const isExpanded = expandedDirs.has(entry.path) || isRoot;
    
    const getIcon = () => {
      if (entry.type === 'directory') {
        return isExpanded ? 
          <FolderOpen className="h-3.5 w-3.5 text-blue-500" /> : 
          <Folder className="h-3.5 w-3.5 text-blue-500" />;
      }
      
      // File type icons based on extension
      const ext = entry.name.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'rs':
          return <FileCode className="h-3.5 w-3.5 text-orange-500" />;
        case 'toml':
        case 'yaml':
        case 'yml':
        case 'json':
          return <FileText className="h-3.5 w-3.5 text-yellow-500" />;
        case 'md':
          return <FileText className="h-3.5 w-3.5 text-blue-400" />;
        case 'js':
        case 'jsx':
        case 'ts':
        case 'tsx':
          return <FileCode className="h-3.5 w-3.5 text-yellow-400" />;
        case 'py':
          return <FileCode className="h-3.5 w-3.5 text-blue-500" />;
        case 'go':
          return <FileCode className="h-3.5 w-3.5 text-cyan-500" />;
        case 'sh':
        case 'bash':
          return <Terminal className="h-3.5 w-3.5 text-green-500" />;
        default:
          return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
      }
    };
    
    return (
      <div key={entry.path}>
        <div 
          className={cn(
            "flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-pointer",
            !isRoot && "ml-4"
          )}
          onClick={() => entry.type === 'directory' && hasChildren && toggleDirectory(entry.path)}
        >
          {entry.type === 'directory' && hasChildren && (
            <ChevronRight className={cn(
              "h-3 w-3 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )} />
          )}
          {(!hasChildren || entry.type !== 'directory') && (
            <div className="w-3" />
          )}
          {getIcon()}
          <span className="text-sm font-mono">{entry.name}</span>
        </div>
        
        {entry.type === 'directory' && hasChildren && isExpanded && (
          <div className="ml-2">
            {getChildren(entry.path, entry.level).map(child => renderEntry(child))}
          </div>
        )}
      </div>
    );
  };
  
  // Get root entries
  const rootEntries = entries.filter(e => e.level === 0);
  
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="space-y-1">
        {rootEntries.map(entry => renderEntry(entry, true))}
      </div>
    </div>
  );
};

/**
 * Widget for Read tool
 */
