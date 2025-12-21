import React, { useState, useEffect } from "react";
import {
  Terminal,
  User,
  Bot,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/hooks";
import type { ClaudeStreamMessage } from "./AgentExecution";
import { api, type FileEntry } from "@/lib/api";
import {
  TodoWidget,
  TodoReadWidget,
  LSWidget,
  ReadWidget,
  ReadResultWidget,
  GlobWidget,
  BashWidget,
  WriteWidget,
  GrepWidget,
  EditWidget,
  EditResultWidget,
  MCPWidget,
  CommandWidget,
  CommandOutputWidget,
  SummaryWidget,
  MultiEditWidget,
  MultiEditResultWidget,
  SystemReminderWidget,
  SystemInitializedWidget,
  SystemInstructionWidget,
  TaskWidget,
  LSResultWidget,
  ThinkingWidget,
  WebSearchWidget,
  WebFetchWidget
} from "./ToolWidgets";

interface StreamMessageProps {
  message: ClaudeStreamMessage;
  className?: string;
  streamMessages: ClaudeStreamMessage[];
  onLinkDetected?: (url: string) => void;
  agentOutputMap?: Map<string, any>;
}

/**
 * Parse text and convert @mentions into styled components
 * - @agent-name: colored badges for Claude Code agents
 * - @/path/to/file: file path mentions (show filename only, tooltip shows full path)
 */
const parseAgentMentions = (text: string, agents: Map<string, { color?: string; icon?: string }>): React.ReactNode => {
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
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0]; // @agent-name or @/path/to/file
    const captured = match[1]; // agent-name or /path/to/file

    // Add text before the match
    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    // Check if this is a file path (starts with /)
    if (captured.startsWith('/')) {
      const filePath = captured;
      const fileName = filePath.split('/').pop() || filePath;

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
const renderWithSystemInstructions = (
  contentStr: string,
  agents: Map<string, { color?: string; icon?: string }>,
  keyPrefix: string = ''
): React.ReactNode | null => {
  // Quick check if there are any system instruction tags
  if (!contentStr.includes('<system-instruction>') && !contentStr.includes('<system_instruction>')) {
    return null;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Match both hyphen and underscore variants, but require matching closing tag
  const regex = /<system(-|_)instruction>([\s\S]*?)<\/system\1instruction>/g;
  let match;
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
    parts.push(
      <SystemInstructionWidget key={`${keyPrefix}instruction-${keyIndex++}`} message={instructionMessage} />
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

/**
 * Component to render a single Claude Code stream message
 */
const StreamMessageComponent: React.FC<StreamMessageProps> = ({ message, className, streamMessages, onLinkDetected, agentOutputMap }) => {
  // State to track tool results mapped by tool call ID
  const [toolResults, setToolResults] = useState<Map<string, any>>(new Map());

  // State to track expanded tool results
  const [expandedToolResults, setExpandedToolResults] = useState<Set<number>>(new Set());

  // 🆕 State to track conversation summary expansion
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);

  // Get current theme
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);
  
  // State to store current working directory from system init
  const [cwd, setCwd] = useState<string>("");

  // State to store Claude Code agents
  const [agents, setAgents] = useState<Map<string, { color?: string; icon?: string }>>(new Map());

  // Load Claude Code agents on mount
  useEffect(() => {
    api.listClaudeAgents().then((agentFiles: FileEntry[]) => {
      const agentsMap = new Map<string, { color?: string; icon?: string }>();
      agentFiles.forEach(agent => {
        if (agent.entry_type === 'agent') {
          agentsMap.set(agent.name, {
            color: agent.color,
            icon: agent.icon,
          });
        }
      });
      setAgents(agentsMap);
    }).catch(err => {
      console.error('Failed to load agents:', err);
    });
  }, []);

  // Extract all tool results and cwd from stream messages
  useEffect(() => {
    const results = new Map<string, any>();

    // Iterate through all messages to find tool results and cwd
    streamMessages.forEach(msg => {
      // Extract cwd from system init message
      if (msg.type === "system" && msg.subtype === "init" && msg.cwd) {
        setCwd(msg.cwd);
      }

      if (msg.type === "user" && msg.message?.content && Array.isArray(msg.message.content)) {
        msg.message.content.forEach((content: any) => {
          if (content.type === "tool_result" && content.tool_use_id) {
            results.set(content.tool_use_id, content);
          }
        });
      }
    });

    setToolResults(results);
  }, [streamMessages]);
  
  // Helper to get tool result for a specific tool call ID
  const getToolResult = (toolId: string | undefined): any => {
    if (!toolId) return null;
    return toolResults.get(toolId) || null;
  };
  
  // 🆕 Helper function to identify conversation summary messages
  const isSummaryMessage = (msg: ClaudeStreamMessage): boolean => {
    return msg.isVisibleInTranscriptOnly === true && msg.isCompactSummary === true;
  };

  try {
    // 🆕 Handle conversation summary messages (check this first!)
    if (isSummaryMessage(message)) {
      const content = typeof message.message?.content === 'string'
        ? message.message.content
        : JSON.stringify(message.message?.content || '');

      // Extract title (first line) and summary content
      const lines = content.split('\n');
      const summaryContent = lines.slice(1).join('\n');

      return (
        <Card className="border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-lg my-4 overflow-hidden">
          <CardContent className="p-0">
            {/* Clickable header */}
            <button
              onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
              className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800/30 transition-colors border-b border-blue-200 dark:border-blue-700"
            >
              <div className="flex items-center gap-3">
                {isSummaryExpanded ? (
                  <ChevronDown className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                )}
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-blue-900 dark:text-blue-100 text-sm">
                    Context Summary - Continued
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Previous conversation ended due to context limit
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-4 h-4" />
                {message.timestamp && new Date(message.timestamp).toLocaleString()}
              </div>
            </button>

            {/* Collapsible content */}
            {isSummaryExpanded && (
              <div className="p-4 bg-white dark:bg-gray-800">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded-md border border-gray-200 dark:border-gray-700 overflow-x-auto">
                    {summaryContent.trim()}
                  </pre>
                </div>
              </div>
            )}

            {/* Collapsed hint */}
            {!isSummaryExpanded && (
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 dark:text-gray-400 italic">
                Click to expand full summary of previous conversation...
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    // Skip rendering for meta messages that don't have meaningful content
    if (message.isMeta && !message.leafUuid && !message.summary) {
      return null;
    }

    // Handle summary messages
    if (message.leafUuid && message.summary && (message as any).type === "summary") {
      return <SummaryWidget summary={message.summary} leafUuid={message.leafUuid} />;
    }

    // System initialization message
    if (message.type === "system" && message.subtype === "init") {
      return (
        <SystemInitializedWidget
          sessionId={message.session_id}
          model={message.model}
          cwd={message.cwd}
          tools={message.tools}
        />
      );
    }

    // Assistant message
    if (message.type === "assistant" && message.message) {
      const msg = message.message;
      
      let renderedSomething = false;
      
      const renderedCard = (
        <Card className={cn("border-primary/20 bg-primary/5", className)}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Bot className="h-5 w-5 text-primary mt-0.5" />
              <div className="flex-1 space-y-2 min-w-0">
                {msg.content && Array.isArray(msg.content) && msg.content.map((content: any, idx: number) => {
                  // Text content - render as markdown
                  if (content.type === "text") {
                    // Ensure we have a string to render
                    const textContent = typeof content.text === 'string'
                      ? content.text
                      : (content.text?.text || JSON.stringify(content.text || content));

                    renderedSomething = true;

                    // Check for system-instruction tags first
                    const systemInstructionContent = renderWithSystemInstructions(textContent, agents, `asst-${idx}-`);
                    if (systemInstructionContent) {
                      return <div key={idx}>{systemInstructionContent}</div>;
                    }

                    return (
                      <div key={idx} className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ node, inline, className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              return !inline && match ? (
                                <SyntaxHighlighter
                                  style={syntaxTheme}
                                  language={match[1]}
                                  PreTag="div"
                                  {...props}
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              ) : (
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              );
                            }
                          }}
                        >
                          {textContent}
                        </ReactMarkdown>
                      </div>
                    );
                  }
                  
                  // Thinking content - render with ThinkingWidget
                  if (content.type === "thinking") {
                    renderedSomething = true;
                    return (
                      <div key={idx}>
                        <ThinkingWidget 
                          thinking={content.thinking || ''} 
                          signature={content.signature}
                        />
                      </div>
                    );
                  }
                  
                  // Tool use - render custom widgets based on tool name
                  if (content.type === "tool_use") {
                    const toolName = content.name?.toLowerCase();
                    const input = content.input;
                    const toolId = content.id;
                    
                    // Get the tool result if available
                    const toolResult = getToolResult(toolId);
                    
                    // Function to render the appropriate tool widget
                    const renderToolWidget = () => {
                      // Task tool - for sub-agent tasks
                      if (toolName === "task" && input) {
                        renderedSomething = true;
                        return (
                          <TaskWidget
                            description={input.description}
                            prompt={input.prompt}
                            result={toolResult}
                            toolUseId={toolId}
                            allMessages={streamMessages}
                            agentOutputMap={agentOutputMap}
                          />
                        );
                      }
                      
                      // Edit tool
                      if (toolName === "edit" && input?.file_path) {
                        renderedSomething = true;
                        return <EditWidget {...input} result={toolResult} workspacePath={cwd} />;
                      }
                      
                      // MultiEdit tool
                      if (toolName === "multiedit" && input?.file_path && input?.edits) {
                        renderedSomething = true;
                        return <MultiEditWidget {...input} result={toolResult} />;
                      }
                      
                      // MCP tools (starting with mcp__)
                      if (content.name?.startsWith("mcp__")) {
                        renderedSomething = true;
                        return <MCPWidget toolName={content.name} input={input} result={toolResult} />;
                      }
                      
                      // TodoWrite tool
                      if (toolName === "todowrite" && input?.todos) {
                        renderedSomething = true;
                        return <TodoWidget todos={input.todos} result={toolResult} />;
                      }
                      
                      // TodoRead tool
                      if (toolName === "todoread") {
                        renderedSomething = true;
                        return <TodoReadWidget todos={input?.todos} result={toolResult} />;
                      }
                      
                      // LS tool
                      if (toolName === "ls" && input?.path) {
                        renderedSomething = true;
                        return <LSWidget path={input.path} result={toolResult} workspacePath={cwd} />;
                      }
                      
                      // Read tool
                      if (toolName === "read" && input?.file_path) {
                        renderedSomething = true;
                        return <ReadWidget filePath={input.file_path} result={toolResult} workspacePath={cwd} />;
                      }
                      
                      // Glob tool
                      if (toolName === "glob" && input?.pattern) {
                        renderedSomething = true;
                        return <GlobWidget pattern={input.pattern} result={toolResult} />;
                      }
                      
                      // Bash tool
                      if (toolName === "bash" && input?.command) {
                        renderedSomething = true;
                        return <BashWidget command={input.command} description={input.description} result={toolResult} cwd={cwd} />;
                      }
                      
                      // Write tool
                      if (toolName === "write" && input?.file_path && input?.content) {
                        renderedSomething = true;
                        return <WriteWidget filePath={input.file_path} content={input.content} result={toolResult} workspacePath={cwd} />;
                      }
                      
                      // Grep tool
                      if (toolName === "grep" && input?.pattern) {
                        renderedSomething = true;
                        return <GrepWidget pattern={input.pattern} include={input.include} path={input.path} exclude={input.exclude} result={toolResult} />;
                      }
                      
                      // WebSearch tool
                      if (toolName === "websearch" && input?.query) {
                        renderedSomething = true;
                        return <WebSearchWidget query={input.query} result={toolResult} />;
                      }
                      
                      // WebFetch tool
                      if (toolName === "webfetch" && input?.url) {
                        renderedSomething = true;
                        return <WebFetchWidget url={input.url} prompt={input.prompt} result={toolResult} />;
                      }
                      
                      // Default - return null
                      return null;
                    };
                    
                    // Render the tool widget
                    const widget = renderToolWidget();
                    if (widget) {
                      renderedSomething = true;
                      return <div key={idx}>{widget}</div>;
                    }

                    // Skip hidden tools (like AgentOutputTool - results shown in TaskWidget)
                    if (toolName === "agentoutputtool") {
                      return null;
                    }

                    // Fallback to basic tool display
                    renderedSomething = true;
                    return (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Terminal className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            Using tool: <code className="font-mono">{content.name}</code>
                          </span>
                        </div>
                        {content.input && (
                          <div className="ml-6 p-2 bg-background rounded-md border">
                            <pre className="text-xs font-mono overflow-x-auto">
                              {JSON.stringify(content.input, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  return null;
                })}
                
                {msg.usage && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Tokens: {msg.usage.input_tokens} in, {msg.usage.output_tokens} out
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
      
      if (!renderedSomething) return null;
      return renderedCard;
    }

    // User message - handle both nested and direct content structures
    if (message.type === "user") {
      // Don't render meta messages, which are for system use
      if (message.isMeta) return null;

      // Handle different message structures
      const msg = message.message || message;
      
      let renderedSomething = false;
      
      const renderedCard = (
        <Card className={cn("border-muted-foreground/20 bg-muted/20", className)}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-2 min-w-0">
                {/* Handle content that is a simple string (e.g. from user commands) */}
                {(typeof msg.content === 'string' || (msg.content && !Array.isArray(msg.content))) && (
                  (() => {
                    const contentStr = typeof msg.content === 'string' ? msg.content : String(msg.content);
                    if (contentStr.trim() === '') return null;
                    renderedSomething = true;
                    
                    // Check if it's a command message
                    const commandMatch = contentStr.match(/<command-name>(.+?)<\/command-name>[\s\S]*?<command-message>(.+?)<\/command-message>[\s\S]*?<command-args>(.*?)<\/command-args>/);
                    if (commandMatch) {
                      const [, commandName, commandMessage, commandArgs] = commandMatch;
                      return (
                        <CommandWidget 
                          commandName={commandName.trim()} 
                          commandMessage={commandMessage.trim()}
                          commandArgs={commandArgs?.trim()}
                        />
                      );
                    }
                    
                    // Check if it's command output
                    const stdoutMatch = contentStr.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
                    if (stdoutMatch) {
                      const [, output] = stdoutMatch;
                      return <CommandOutputWidget output={output} onLinkDetected={onLinkDetected} />;
                    }

                    // Check if it contains system-instruction tags (support multiple, both underscore and hyphen)
                    const systemInstructionContent = renderWithSystemInstructions(contentStr, agents, 'user-str-');
                    if (systemInstructionContent) {
                      return systemInstructionContent;
                    }

                    // Otherwise render as plain text with agent mention parsing
                    return (
                      <div className="text-sm whitespace-pre-wrap">
                        {parseAgentMentions(contentStr, agents)}
                      </div>
                    );
                  })()
                )}

                {/* Handle content that is an array of parts */}
                {Array.isArray(msg.content) && msg.content.map((content: any, idx: number) => {
                  // Tool result
                  if (content.type === "tool_result") {
                    // Skip duplicate tool_result if a dedicated widget is present
                    let hasCorrespondingWidget = false;
                    if (content.tool_use_id && streamMessages) {
                      for (let i = streamMessages.length - 1; i >= 0; i--) {
                        const prevMsg = streamMessages[i];
                        if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                          const toolUse = prevMsg.message.content.find((c: any) => c.type === 'tool_use' && c.id === content.tool_use_id);
                          if (toolUse) {
                            const toolName = toolUse.name?.toLowerCase();
                            const toolsWithWidgets = ['task','edit','multiedit','todowrite','todoread','ls','read','glob','bash','write','grep','websearch','webfetch','agentoutputtool'];
                            if (toolsWithWidgets.includes(toolName) || toolUse.name?.startsWith('mcp__')) {
                              hasCorrespondingWidget = true;
                            }
                            break;
                          }
                        }
                      }
                    }

                    if (hasCorrespondingWidget) {
                      return null;
                    }
                    // Extract the actual content string
                    let contentText = '';
                    if (typeof content.content === 'string') {
                      contentText = content.content;
                    } else if (content.content && typeof content.content === 'object') {
                      // Handle object with text property
                      if (content.content.text) {
                        contentText = content.content.text;
                      } else if (content.content.result) {
                        contentText = content.content.result;
                      } else if (content.content.output) {
                        contentText = content.content.output;
                      } else if (content.content.content) {
                        contentText = content.content.content;
                      } else if (Array.isArray(content.content)) {
                        // Handle array of content blocks
                        contentText = content.content
                          .map((c: any) => {
                            if (typeof c === 'string') return c;
                            if (c.text) return c.text;
                            if (c.result) return c.result;
                            if (c.output) return c.output;
                            if (c.content) return c.content;
                            // Better object handling
                            try {
                              return JSON.stringify(c, (key, value) => {
                                if (value && typeof value === 'object') {
                                  // Handle circular references
                                  if (key === 'parent' || key === 'children' || key === 'nextSibling' || key === 'previousSibling') {
                                    return '[Circular Reference]';
                                  }
                                  // Handle functions
                                  if (typeof value === 'function') {
                                    return '[Function]';
                                  }
                                  // Handle HTML elements
                                  if (value && typeof value.nodeType === 'number') {
                                    return '[HTMLElement]';
                                  }
                                }
                                return value;
                              }, 2);
                            } catch (e) {
                              return '[Object]';
                            }
                          })
                          .join('\n');
                      } else {
                        // Better fallback to JSON stringify with circular reference handling
                        try {
                          contentText = JSON.stringify(content.content, (key, value) => {
                            if (value && typeof value === 'object') {
                              // Handle circular references
                              if (key === 'parent' || key === 'children' || key === 'nextSibling' || key === 'previousSibling') {
                                return '[Circular Reference]';
                              }
                              // Handle functions
                              if (typeof value === 'function') {
                                return '[Function]';
                              }
                              // Handle HTML elements
                              if (value && typeof value.nodeType === 'number') {
                                return '[HTMLElement]';
                              }
                            }
                            return value;
                          }, 2);
                        } catch (e) {
                          // If JSON.stringify fails, use Object.prototype.toString
                          contentText = Object.prototype.toString.call(content.content);
                        }
                      }
                    } else {
                      contentText = String(content.content || '');
                    }
                    
                    // Always show system reminders regardless of widget status
                    const reminderMatch = contentText.match(/<system-reminder>(.*?)<\/system-reminder>/s);
                    if (reminderMatch) {
                      const reminderMessage = reminderMatch[1].trim();
                      const beforeReminder = contentText.substring(0, reminderMatch.index || 0).trim();
                      const afterReminder = contentText.substring((reminderMatch.index || 0) + reminderMatch[0].length).trim();
                      
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Tool Result</span>
                          </div>
                          
                          {beforeReminder && (
                            <div className="ml-6 p-2 bg-background rounded-md border">
                              <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                                {beforeReminder}
                              </pre>
                            </div>
                          )}
                          
                          <div className="ml-6">
                            <SystemReminderWidget message={reminderMessage} />
                          </div>
                          
                          {afterReminder && (
                            <div className="ml-6 p-2 bg-background rounded-md border">
                              <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                                {afterReminder}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    }
                    
                    // Check if this is an Edit tool result
                    const isEditResult = contentText.includes("has been updated. Here's the result of running `cat -n`");
                    
                    if (isEditResult) {
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Edit Result</span>
                          </div>
                          <EditResultWidget content={contentText} />
                        </div>
                      );
                    }
                    
                    // Check if this is a MultiEdit tool result
                    const isMultiEditResult = contentText.includes("has been updated with multiple edits") || 
                                             contentText.includes("MultiEdit completed successfully") ||
                                             contentText.includes("Applied multiple edits to");
                    
                    if (isMultiEditResult) {
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">MultiEdit Result</span>
                          </div>
                          <MultiEditResultWidget content={contentText} />
                        </div>
                      );
                    }
                    
                    // Check if this is an LS tool result (directory tree structure)
                    const isLSResult = (() => {
                      if (!content.tool_use_id || typeof contentText !== 'string') return false;
                      
                      // Check if this result came from an LS tool by looking for the tool call
                      let isFromLSTool = false;
                      
                      // Search in previous assistant messages for the matching tool_use
                      if (streamMessages) {
                        for (let i = streamMessages.length - 1; i >= 0; i--) {
                          const prevMsg = streamMessages[i];
                          // Only check assistant messages
                          if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                            const toolUse = prevMsg.message.content.find((c: any) => 
                              c.type === 'tool_use' && 
                              c.id === content.tool_use_id &&
                              c.name?.toLowerCase() === 'ls'
                            );
                            if (toolUse) {
                              isFromLSTool = true;
                              break;
                            }
                          }
                        }
                      }
                      
                      // Only proceed if this is from an LS tool
                      if (!isFromLSTool) return false;
                      
                      // Additional validation: check for tree structure pattern
                      const lines = contentText.split('\n');
                      const hasTreeStructure = lines.some(line => /^\s*-\s+/.test(line));
                      const hasNoteAtEnd = lines.some(line => line.trim().startsWith('NOTE: do any of the files'));
                      
                      return hasTreeStructure || hasNoteAtEnd;
                    })();
                    
                    if (isLSResult) {
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Directory Contents</span>
                          </div>
                          <LSResultWidget content={contentText} />
                        </div>
                      );
                    }
                    
                    // Check if this is a Read tool result (contains line numbers with arrow separator)
                    const isReadResult = content.tool_use_id && typeof contentText === 'string' && 
                      /^\s*\d+→/.test(contentText);
                    
                    if (isReadResult) {
                      // Try to find the corresponding Read tool call to get the file path
                      let filePath: string | undefined;
                      
                      // Search in previous assistant messages for the matching tool_use
                      if (streamMessages) {
                        for (let i = streamMessages.length - 1; i >= 0; i--) {
                          const prevMsg = streamMessages[i];
                          // Only check assistant messages
                          if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                            const toolUse = prevMsg.message.content.find((c: any) => 
                              c.type === 'tool_use' && 
                              c.id === content.tool_use_id &&
                              c.name?.toLowerCase() === 'read'
                            );
                            if (toolUse?.input?.file_path) {
                              filePath = toolUse.input.file_path;
                              break;
                            }
                          }
                        }
                      }
                      
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Read Result</span>
                          </div>
                          <ReadResultWidget content={contentText} filePath={filePath} workspacePath={cwd} />
                        </div>
                      );
                    }
                    
                    // Handle empty tool results
                    if (!contentText || contentText.trim() === '') {
                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Tool Result</span>
                          </div>
                          <div className="ml-6 p-3 bg-muted/50 rounded-md border text-sm text-muted-foreground italic">
                            Tool did not return any output
                          </div>
                        </div>
                      );
                    }

                    // Render Tool Result with collapsible functionality
                    renderedSomething = true;
                    const isExpanded = expandedToolResults.has(idx);
                    const toggleExpanded = () => {
                      setExpandedToolResults(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) {
                          next.delete(idx);
                        } else {
                          next.add(idx);
                        }
                        return next;
                      });
                    };

                    return (
                      <div key={idx} className="space-y-2">
                        <button
                          onClick={toggleExpanded}
                          className="w-full flex items-center gap-2 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors text-left"
                        >
                          {content.is_error ? (
                            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          )}
                          <span className="text-sm font-medium">Tool Result</span>
                          <ChevronDown className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform ml-auto flex-shrink-0",
                            isExpanded && "rotate-180"
                          )} />
                        </button>

                        {isExpanded && (
                          <div className="p-3 rounded-lg border bg-card/50">
                            <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                              {contentText}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  // Text content
                  if (content.type === "text") {
                    // Handle both string and object formats
                    let textContent = '';
                    if (typeof content.text === 'string') {
                      textContent = content.text;
                    } else if (content.text && typeof content.text === 'object') {
                      if (content.text.text) {
                        textContent = content.text.text;
                      } else if (content.text.content) {
                        textContent = content.text.content;
                      } else if (content.text.result) {
                        textContent = content.text.result;
                      } else if (content.text.output) {
                        textContent = content.text.output;
                      } else {
                        // Better object handling
                        try {
                          textContent = JSON.stringify(content.text, (key, value) => {
                            if (value && typeof value === 'object') {
                              // Handle circular references
                              if (key === 'parent' || key === 'children' || key === 'nextSibling' || key === 'previousSibling') {
                                return '[Circular Reference]';
                              }
                              // Handle functions
                              if (typeof value === 'function') {
                                return '[Function]';
                              }
                              // Handle HTML elements
                              if (value && typeof value.nodeType === 'number') {
                                return '[HTMLElement]';
                              }
                            }
                            return value;
                          }, 2);
                        } catch (e) {
                          textContent = Object.prototype.toString.call(content.text);
                        }
                      }
                    } else {
                      textContent = String(content.text || '');
                    }
                    
                    renderedSomething = true;

                    // Check for system-instruction tags
                    const systemInstructionContent = renderWithSystemInstructions(textContent, agents, `user-arr-${idx}-`);
                    if (systemInstructionContent) {
                      return <div key={idx}>{systemInstructionContent}</div>;
                    }

                    return (
                      <div key={idx} className="text-sm whitespace-pre-wrap">
                        {parseAgentMentions(textContent, agents)}
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      );
      if (!renderedSomething) return null;
      return renderedCard;
    }

    // Result message - render with markdown
    if (message.type === "result") {
      const isError = message.is_error || message.subtype?.includes("error");
      const [expanded, setExpanded] = useState(false);

      return (
        <Card className={cn(
          isError ? "border-destructive/20 bg-destructive/5" : "border-green-500/20 bg-green-500/5",
          className
        )}>
          <CardContent className="p-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-start gap-3 text-left hover:opacity-80 transition-opacity"
            >
              {isError ? (
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <h4 className="font-semibold text-sm">
                  {isError ? "Execution Failed" : "Execution Complete"}
                </h4>
              </div>
              <ChevronDown className={cn(
                "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-0.5",
                expanded && "rotate-180"
              )} />
            </button>

            {expanded && (
              <div className="ml-8 mt-4 space-y-2">
                {message.result && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={syntaxTheme}
                              language={match[1]}
                              PreTag="div"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {message.result}
                    </ReactMarkdown>
                  </div>
                )}

                {message.error && (
                  <div className="text-sm text-destructive">{message.error}</div>
                )}

                <div className="text-xs text-muted-foreground space-y-1 mt-2">
                  {((message.cost_usd !== undefined && message.cost_usd !== null) ||
                    (message.total_cost_usd !== undefined && message.total_cost_usd !== null)) && (
                    <div>Cost: ${(message.cost_usd || message.total_cost_usd || 0).toFixed(4)} USD</div>
                  )}
                  {message.duration_ms !== undefined && (
                    <div>Duration: {(message.duration_ms / 1000).toFixed(2)}s</div>
                  )}
                  {message.num_turns !== undefined && (
                    <div>Turns: {message.num_turns}</div>
                  )}
                  {message.usage && (
                    <div>
                      Total tokens: {message.usage.input_tokens + message.usage.output_tokens}
                      ({message.usage.input_tokens} in, {message.usage.output_tokens} out)
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      );
    }

    // Skip rendering if no meaningful content
    return null;
  } catch (error) {
    // If any error occurs during rendering, show a safe error message
    console.error("Error rendering stream message:", error, message);
    return (
      <Card className={cn("border-destructive/20 bg-destructive/5", className)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Error rendering message</p>
              <p className="text-xs text-muted-foreground mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
};

export const StreamMessage = React.memo(StreamMessageComponent);
