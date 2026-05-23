import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { basename, isAbsolutePath } from "@/lib/pathUtils";
import { api, type FileEntry } from "@/lib/api";
import { SystemInstructionWidget } from "../tool-widgets";

type AgentPresentationMap = Map<string, { color?: string; icon?: string }>;

let cachedAgents: AgentPresentationMap = new Map();
let agentsLoadPromise: Promise<void> | null = null;
const agentStoreListeners = new Set<() => void>();

export function subscribeAgents(listener: () => void): () => void {
  agentStoreListeners.add(listener);
  return () => agentStoreListeners.delete(listener);
}

export function getAgentsSnapshot(): AgentPresentationMap {
  return cachedAgents;
}

export function loadAgentsOnce(): void {
  if (agentsLoadPromise) return;

  agentsLoadPromise = api.listClaudeAgents().then((agentFiles: FileEntry[]) => {
    const nextAgents = new Map<string, { color?: string; icon?: string }>();
    agentFiles.forEach(agent => {
      if (agent.entry_type === 'agent') {
        nextAgents.set(agent.name, {
          color: agent.color,
          icon: agent.icon,
        });
      }
    });
    cachedAgents = nextAgents;
    agentStoreListeners.forEach((listener) => listener());
  }).catch((err: unknown) => {
    agentsLoadPromise = null;
    console.error('Failed to load agents:', err);
  });
}

/**
 * Parse text and convert @mentions into styled components
 * - @agent-name: colored badges for Claude Code agents
 * - @/path/to/file: file path mentions (show filename only, tooltip shows full path)
 */
export const parseAgentMentions = (text: string, agents: Map<string, { color?: string; icon?: string }>): React.ReactNode => {
  // Match both @agent-name and @/path/to/file patterns
  const mentionRegex = /@([a-zA-Z0-9-_]+|[^\s]+)/g;

  // If no @ mentions found, return the original text
  if (!mentionRegex.test(text)) {
    return text;
  }

  // Reset regex lastIndex after test
  mentionRegex.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0]; // @agent-name or @/path/to/file
    const captured = match[1]; // agent-name or /path/to/file

    // Add text before the match
    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    // Check if this is a file path.
    if (isAbsolutePath(captured)) {
      const filePath = captured;
      const fileName = basename(filePath, filePath);

      // Determine file type by extension
      const ext = fileName.split('.').pop()?.toLowerCase();
      const isImage = ext && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
      const isCode = ext && ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h'].includes(ext);
      const isDoc = ext && ['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css'].includes(ext);

      // Choose colors based on file type
      let colors = { bg: 'bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-500/20' };
      if (isImage) {
        colors = { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/20' };
      } else if (isCode) {
        colors = { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' };
      } else if (isDoc) {
        colors = { bg: 'bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-500/20' };
      }

      parts.push(
        <span
          key={`file-${matchIndex}`}
          className={`inline-flex items-center px-2 py-0.5 mx-1 rounded-md text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border} cursor-pointer hover:opacity-80 transition-opacity`}
          title={filePath}
          onClick={() => {
            // TODO: Add click handler for file preview
            if (isImage) {
              console.log('Open image preview:', filePath);
              // onLinkDetected could be extended to handle image previews
            }
          }}
        >
          @{filePath}
        </span>
      );
    }
    // Check if this is a known Claude Code agent
    else {
      const agentName = captured;
      const agentInfo = agents.get(agentName);

      if (agentInfo) {
        // Map color names to Tailwind classes
        const colorMap: Record<string, { bg: string; text: string; border: string }> = {
          'red': { bg: 'bg-red-500/20', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30' },
          'blue': { bg: 'bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' },
          'green': { bg: 'bg-green-500/20', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30' },
          'yellow': { bg: 'bg-yellow-500/20', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500/30' },
          'purple': { bg: 'bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30' },
          'orange': { bg: 'bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/30' },
        };

        const colors = agentInfo.color ? colorMap[agentInfo.color] : null;
        const defaultColors = { bg: 'bg-primary/20', text: 'text-primary', border: 'border-primary/30' };
        const finalColors = colors || defaultColors;

        parts.push(
          <span
            key={`agent-${matchIndex}`}
            className={`inline-flex items-center px-2 py-0.5 mx-1 rounded-md text-xs font-medium ${finalColors.bg} ${finalColors.text} border ${finalColors.border}`}
            title={`Agent: ${agentName}`}
          >
            @{agentName}
          </span>
        );
      } else {
        // For non-agent, non-file mentions, render as plain text
        parts.push(fullMatch);
      }
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  // Add remaining text after the last match
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return <>{parts}</>;
};

/**
 * Parse text containing system-instruction tags and render them with SystemInstructionWidget
 * Returns null if no system-instruction tags are found
 * Supports both <system-instruction> and <system_instruction> formats
 */
const markdownRemarkPlugins = [remarkGfm];

export const MarkdownContent = React.memo(function MarkdownContent({ text, syntaxTheme }: { text: string; syntaxTheme: any }) {
  const components = useMemo(() => ({
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const code = String(children).replace(/\n$/, '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={syntaxTheme}
          language={match[1]}
          PreTag="div"
          codeTagProps={{ className: "!text-foreground" }}
          {...props}
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
  }), [syntaxTheme]);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

export const renderWithSystemInstructions = (
  contentStr: string,
  agents: Map<string, { color?: string; icon?: string }>,
  keyPrefix: string = '',
  getExpansionProps?: (cardId: string, defaultExpanded: boolean) => { defaultExpanded?: boolean; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }
): React.ReactNode | null => {
  // Quick check if there are any system instruction tags
  if (!contentStr.includes('<system-instruction>') && !contentStr.includes('<system_instruction>')) {
    return null;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Match both hyphen and underscore variants, but require matching closing tag
  const regex = /<system(-|_)instruction>([\s\S]*?)<\/system\1instruction>/g;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = regex.exec(contentStr)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textBefore = contentStr.substring(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push(
          <div key={`${keyPrefix}text-${keyIndex++}`} className="text-sm whitespace-pre-wrap">
            {parseAgentMentions(textBefore, agents)}
          </div>
        );
      }
    }

    // Add the system instruction widget
    const instructionMessage = match[2].trim();
    const instructionIndex = keyIndex++;
    parts.push(
      <SystemInstructionWidget
        key={`${keyPrefix}instruction-${instructionIndex}`}
        message={instructionMessage}
        {...getExpansionProps?.(`${keyPrefix}system-instruction-${instructionIndex}`, false)}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last match
  if (lastIndex < contentStr.length) {
    const textAfter = contentStr.substring(lastIndex).trim();
    if (textAfter) {
      parts.push(
        <div key={`${keyPrefix}text-${keyIndex++}`} className="text-sm whitespace-pre-wrap">
          {parseAgentMentions(textAfter, agents)}
        </div>
      );
    }
  }

  // Only return if we found and processed at least one system instruction
  if (parts.length > 0) {
    return <div className="space-y-2">{parts}</div>;
  }

  return null;
};
