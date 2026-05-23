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

export const WebSearchWidget: React.FC<{
  query: string;
  result?: any;
} & ControlledExpansionProps> = ({ query, result, ...expansionProps }) => {
  const [isExpanded, setExpanded] = useControlledExpansion(expansionProps);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // Parse the result to extract all links sections and build a structured representation
  const parseSearchResult = (resultContent: string) => {
    const sections: Array<{
      type: 'text' | 'links';
      content: string | Array<{ title: string; url: string }>;
    }> = [];
    
    // Split by "Links: [" to find all link sections
    const parts = resultContent.split(/Links:\s*\[/);
    
    // First part is always text (or empty)
    if (parts[0]) {
      sections.push({ type: 'text', content: parts[0].trim() });
    }
    
    // Process each links section
    parts.slice(1).forEach(part => {
      try {
        // Find the closing bracket
        const closingIndex = part.indexOf(']');
        if (closingIndex === -1) return;
        
        const linksJson = '[' + part.substring(0, closingIndex + 1);
        const remainingText = part.substring(closingIndex + 1).trim();
        
        // Parse the JSON array
        const links = JSON.parse(linksJson);
        sections.push({ type: 'links', content: links });
        
        // Add any remaining text
        if (remainingText) {
          sections.push({ type: 'text', content: remainingText });
        }
      } catch (e) {
        // If parsing fails, treat it as text
        sections.push({ type: 'text', content: 'Links: [' + part });
      }
    });
    
    return sections;
  };
  
  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };
  
  const extractPlainTextLinks = (resultContent: string): Array<{ title: string; url: string }> => {
    const links: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();
    const urlRegex = /https?:\/\/[^\s)\]}>,]+/g;
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(resultContent)) !== null) {
      const url = match[0];
      if (seen.has(url)) continue;
      seen.add(url);

      const beforeUrl = resultContent.slice(0, match.index).split('\n').filter((line) => line.trim()).pop()?.trim();
      const title = beforeUrl?.replace(/^[-*\d.\s]+/, '').replace(/[*_`]/g, '').trim() || url;
      links.push({ title, url });
    }

    return links;
  };

  // Extract result content if available
  let searchResults: {
    sections: Array<{
      type: 'text' | 'links';
      content: string | Array<{ title: string; url: string }>;
    }>;
    noResults: boolean;
  } = { sections: [], noResults: false };

  if (result) {
    const rawContent = result.content ?? result.results ?? result;
    const structuredResults = Array.isArray(rawContent)
      ? rawContent.flatMap((item: any) => {
        if (item?.type === 'web_search_result') {
          return [{ title: item.title || item.url, url: item.url }];
        }
        if (item?.url) {
          return [{ title: item.title || item.url, url: item.url }];
        }
        return [];
      })
      : [];

    if (structuredResults.length > 0) {
      searchResults.sections = [{ type: 'links', content: structuredResults }];
    } else {
      let resultContent = '';
      if (typeof rawContent === 'string') {
        resultContent = rawContent;
      } else if (rawContent && typeof rawContent === 'object') {
        if (rawContent.text) {
          resultContent = rawContent.text;
        } else if (Array.isArray(rawContent)) {
          resultContent = rawContent
            .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
            .join('\n');
        } else {
          resultContent = JSON.stringify(rawContent, null, 2);
        }
      }

      const sections = parseSearchResult(resultContent);
      const plainTextLinks = extractPlainTextLinks(resultContent);
      if (plainTextLinks.length > 0) {
        searchResults.sections = [
          ...sections.filter((section) => section.type === 'text'),
          { type: 'links', content: plainTextLinks },
        ];
      } else {
        searchResults.noResults = resultContent.toLowerCase().includes('no links found') ||
                                   resultContent.toLowerCase().includes('no results');
        searchResults.sections = sections;
      }
    }
  }
  
  const handleLinkClick = async (url: string) => {
    try {
      await open(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  };
  
  // Count total links across all sections
  const totalLinks = searchResults.sections
    .filter(s => s.type === 'links')
    .reduce((sum, s) => sum + (Array.isArray(s.content) ? s.content.length : 0), 0);

  // Check if still loading (has result but no parsed sections yet)
  const isLoading = result && !searchResults.sections.length;

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden">
      {/* Clickable Header */}
      <button
        onClick={() => !isLoading && setExpanded(!isExpanded)}
        disabled={isLoading}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-500/10 transition-colors disabled:cursor-default"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe className="h-4 w-4 text-blue-500/70 flex-shrink-0" />
          <span className="text-xs font-medium uppercase tracking-wider text-blue-600/70 dark:text-blue-400/70 flex-shrink-0">
            Web Search
          </span>
          <span className="text-sm text-muted-foreground/80 truncate">{query}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <div className="h-1 w-1 bg-blue-500 rounded-full [animation-delay:-0.3s]"></div>
              <div className="h-1 w-1 bg-blue-500 rounded-full [animation-delay:-0.15s]"></div>
              <div className="h-1 w-1 bg-blue-500 rounded-full"></div>
            </div>
          ) : searchResults.noResults ? (
            <span className="text-xs text-muted-foreground">No results</span>
          ) : totalLinks > 0 ? (
            <span className="text-xs text-muted-foreground">{totalLinks} results</span>
          ) : null}
          {!isLoading && (
            <ChevronRight className={cn(
              "h-4 w-4 text-blue-500/50 transition-transform",
              isExpanded && "rotate-90"
            )} />
          )}
        </div>
      </button>

      {/* Expandable Results */}
      {isExpanded && searchResults.sections.length > 0 && !searchResults.noResults && (
        <div className="border-t border-blue-500/20 p-3 space-y-3">
          {searchResults.sections.map((section, idx) => {
            if (section.type === 'text') {
              return (
                <div key={idx} className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{section.content as string}</ReactMarkdown>
                </div>
              );
            } else if (section.type === 'links' && Array.isArray(section.content)) {
              const links = section.content;
              const isSectionExpanded = expandedSections.has(idx);

              return (
                <div key={idx} className="space-y-1.5">
                  {/* Toggle Button */}
                  <button
                    onClick={() => toggleSection(idx)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isSectionExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span>{links.length} result{links.length !== 1 ? 's' : ''}</span>
                  </button>

                  {/* Links Display */}
                  {isSectionExpanded ? (
                    /* Expanded Card View */
                    <div className="grid gap-1.5 ml-4">
                      {links.map((link, linkIdx) => (
                        <button
                          key={linkIdx}
                          onClick={() => handleLinkClick(link.url)}
                          className="group flex flex-col gap-0.5 p-2.5 rounded-md border bg-card/30 hover:bg-card/50 hover:border-blue-500/30 transition-all text-left"
                        >
                          <div className="flex items-start gap-2">
                            <Globe2 className="h-3.5 w-3.5 text-blue-500/70 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium group-hover:text-blue-500 transition-colors line-clamp-2">
                                {link.title}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                {link.url}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    /* Collapsed Pills View */
                    <div className="flex flex-wrap gap-1.5 ml-4">
                      {links.map((link, linkIdx) => (
                        <button
                          key={linkIdx}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLinkClick(link.url);
                          }}
                          className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/20 transition-all"
                        >
                          <Globe2 className="h-3 w-3 text-blue-500/70" />
                          <span className="truncate max-w-[180px] text-foreground/70 group-hover:text-foreground/90">
                            {link.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Widget for displaying AI thinking/reasoning content
 * Collapsible and closed by default
 */
