import React, { useState, useMemo, useSyncExternalStore } from "react";
import {
  Terminal,
  User,
  Bot,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/hooks";
import type { ClaudeStreamMessage } from "./AgentExecution";
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
  TaskWidget,
  LSResultWidget,
  ThinkingWidget,
  WebSearchWidget,
  WebFetchWidget
} from "./tool-widgets";
import { getUserMessagePresentation } from "./ai-code-session/utils/messagePresentation";
import { summarizeRuntimeMessage } from "./ai-code-session/utils/runtimePresentation";
import { CollapsibleTextCard } from "./stream-message/CollapsibleTextCard";
import {
  MarkdownContent,
  getAgentsSnapshot,
  loadAgentsOnce,
  parseAgentMentions,
  renderWithSystemInstructions,
  subscribeAgents,
} from "./stream-message/rendering";
import {
  buildStreamMessageContext,
  streamMessagePropsAreEqual,
  type StreamMessageContext,
  type StreamMessageProps,
} from "./stream-message/context";
import { SummaryMessageCard } from "./stream-message/SummaryMessageCard";
import {
  ErrorMessageCard,
  RenderFailureCard,
  ResultMessageCard,
  RuntimeEventCard,
  SystemInitCard,
} from "./stream-message/MessageCards";

export { buildStreamMessageContext };
export type { StreamMessageContext };

function formatEventDetails(message: ClaudeStreamMessage): string {
  try {
    const serialized = JSON.stringify(message, null, 2);
    return serialized.length > 2000 ? `${serialized.slice(0, 1999)}…` : serialized;
  } catch (_err) {
    return String(message);
  }
}

/**
 * Component to render a single Claude Code stream message
 */
const StreamMessageComponent: React.FC<StreamMessageProps> = ({ message, className, streamMessages, streamContext, onLinkDetected, agentOutputMap, isStreamingText = false, expandedCards, onExpandedCardsChange, messageKey }) => {
  const sharedStreamContext = useMemo(
    () => streamContext ?? buildStreamMessageContext(streamMessages),
    [streamContext, streamMessages]
  );
  const toolResults = sharedStreamContext.toolResults;
  const cwd = sharedStreamContext.cwd;

  // Get current theme
  const { theme } = useTheme();
  const syntaxTheme = useMemo(() => getClaudeSyntaxTheme(theme), [theme]);
  const [uncontrolledExpandedCards, setUncontrolledExpandedCards] = useState<Set<string>>(new Set());

  const agents = useSyncExternalStore(subscribeAgents, getAgentsSnapshot, getAgentsSnapshot);
  loadAgentsOnce();

  // Helper to get tool result for a specific tool call ID
  const getToolResult = (toolId: string | undefined): any => {
    if (!toolId) return null;
    return toolResults.get(toolId) || null;
  };

  const getCardExpansionProps = (cardId: string, defaultExpanded: boolean) => {
    const currentExpandedCards = expandedCards ?? uncontrolledExpandedCards;
    const updateExpandedCards = onExpandedCardsChange ?? setUncontrolledExpandedCards;
    const expandedKey = `${messageKey ?? message.uuid ?? 'message'}:${cardId}`;

    return {
      defaultExpanded,
      expanded: currentExpandedCards.has(expandedKey) || (defaultExpanded && !currentExpandedCards.has(`${expandedKey}:collapsed`)),
      onExpandedChange: (expanded: boolean) => {
        updateExpandedCards((cards) => {
          const nextExpandedCards = new Set(cards);
          nextExpandedCards.delete(`${expandedKey}:collapsed`);
          if (expanded) {
            nextExpandedCards.add(expandedKey);
          } else {
            nextExpandedCards.delete(expandedKey);
            nextExpandedCards.add(`${expandedKey}:collapsed`);
          }
          return nextExpandedCards;
        });
      },
    };
  };

  // 🆕 Helper function to identify conversation summary messages
  const isSummaryMessage = (msg: ClaudeStreamMessage): boolean => {
    return msg.isVisibleInTranscriptOnly === true && msg.isCompactSummary === true;
  };

  const runtimeSummary = summarizeRuntimeMessage(message as any);

  try {
    // 🆕 Handle conversation summary messages (check this first!)
    if (isSummaryMessage(message)) {
      const content = typeof message.message?.content === 'string'
        ? message.message.content
        : JSON.stringify(message.message?.content || '');
      const summaryExpansion = getCardExpansionProps('conversation-summary', false);
      return <SummaryMessageCard message={message} content={content} expansion={summaryExpansion} />;
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
        <SystemInitCard
          message={message}
          runtimeSummary={runtimeSummary}
          expansion={getCardExpansionProps('system-init', false)}
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
                {runtimeSummary && (
                  <div className="text-xs text-muted-foreground">{runtimeSummary}</div>
                )}
                {msg.content && Array.isArray(msg.content) && msg.content.map((content: any, idx: number) => {
                  // Text content - render as markdown
                  if (content.type === "text") {
                    // Ensure we have a string to render
                    const textContent = typeof content.text === 'string'
                      ? content.text
                      : (content.text?.text || JSON.stringify(content.text || content));

                    renderedSomething = true;

                    // Check for system-instruction tags first
                    const systemInstructionContent = renderWithSystemInstructions(textContent, agents, `asst-${idx}-`, getCardExpansionProps);
                    if (systemInstructionContent) {
                      return <div key={idx}>{systemInstructionContent}</div>;
                    }

                    if (isStreamingText) {
                      return (
                        <div key={idx} className="text-sm whitespace-pre-wrap break-words leading-6">
                          {textContent}
                        </div>
                      );
                    }

                    return <MarkdownContent key={idx} text={textContent} syntaxTheme={syntaxTheme} />;
                  }
                  
                  // Thinking content - render with ThinkingWidget
                  if (content.type === "thinking") {
                    renderedSomething = true;
                    return (
                      <div key={idx}>
                        <ThinkingWidget
                          thinking={content.thinking || ''}
                          signature={content.signature}
                          {...getCardExpansionProps(`thinking-${idx}`, false)}
                        />
                      </div>
                    );
                  }
                  
                  // Tool use - render custom widgets based on tool name
                  if (content.type === "tool_use" || content.type === "server_tool_use") {
                    const toolName = content.name?.toLowerCase();
                    const input = content.input;
                    const toolId = content.id;
                    const toolCardKey = `tool-${toolName || 'unknown'}-${toolId || idx}`;

                    // Get the tool result if available
                    const toolResult = getToolResult(toolId);
                    
                    // Function to render the appropriate tool widget
                    const renderToolWidget = () => {
                      // Task tool - for sub-agent tasks (Claude CLI emits "Task" / "Agent" / "AgentTool")
                      if ((toolName === "task" || toolName === "agent" || toolName === "agenttool") && input) {
                        renderedSomething = true;
                        return (
                          <TaskWidget
                            description={input.description}
                            prompt={input.prompt}
                            result={toolResult}
                            toolUseId={toolId}
                            allMessages={streamMessages}
                            agentOutputMap={agentOutputMap}
                            {...getCardExpansionProps(`${toolCardKey}-task-instructions`, false)}
                          />
                        );
                      }
                      
                      // Edit tool
                      if (toolName === "edit" && input?.file_path) {
                        renderedSomething = true;
                        return <EditWidget {...input} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // MultiEdit tool
                      if (toolName === "multiedit" && input?.file_path && input?.edits) {
                        renderedSomething = true;
                        return <MultiEditWidget {...input} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // MCP tools (starting with mcp__)
                      if (content.name?.startsWith("mcp__")) {
                        renderedSomething = true;
                        return <MCPWidget toolName={content.name} input={input} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // TodoWrite tool
                      if (toolName === "todowrite" && input?.todos) {
                        renderedSomething = true;
                        return <TodoWidget todos={input.todos} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // TodoRead tool
                      if (toolName === "todoread") {
                        renderedSomething = true;
                        return <TodoReadWidget todos={input?.todos} result={toolResult} />;
                      }
                      
                      // LS tool
                      if (toolName === "ls" && input?.path) {
                        renderedSomething = true;
                        return <LSWidget path={input.path} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // Read tool
                      if (toolName === "read" && input?.file_path) {
                        renderedSomething = true;
                        return <ReadWidget filePath={input.file_path} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // Glob tool
                      if (toolName === "glob" && input?.pattern) {
                        renderedSomething = true;
                        return <GlobWidget pattern={input.pattern} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // Bash tool
                      if (toolName === "bash" && input?.command) {
                        renderedSomething = true;
                        return <BashWidget command={input.command} description={input.description} result={toolResult} cwd={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // Write tool
                      if (toolName === "write" && input?.file_path && input?.content) {
                        renderedSomething = true;
                        return <WriteWidget filePath={input.file_path} content={input.content} result={toolResult} workspacePath={cwd} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // Grep tool
                      if (toolName === "grep" && input?.pattern) {
                        renderedSomething = true;
                        return <GrepWidget pattern={input.pattern} include={input.include} path={input.path} exclude={input.exclude} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // WebSearch tool
                      if ((toolName === "websearch" || toolName === "web_search") && input?.query) {
                        renderedSomething = true;
                        return <WebSearchWidget query={input.query} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
                      }
                      
                      // WebFetch tool
                      if (toolName === "webfetch" && input?.url) {
                        renderedSomething = true;
                        return <WebFetchWidget url={input.url} prompt={input.prompt} result={toolResult} {...getCardExpansionProps(toolCardKey, false)} />;
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
      const userPresentation = getUserMessagePresentation(message as any);
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

                    if (userPresentation.collapsible) {
                      return (
                        <CollapsibleTextCard
                          title={userPresentation.title}
                          preview={userPresentation.preview}
                          {...getCardExpansionProps('user-string', userPresentation.defaultExpanded)}
                        >
                          <div className="text-sm whitespace-pre-wrap">
                            {parseAgentMentions(contentStr, agents)}
                          </div>
                        </CollapsibleTextCard>
                      );
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
                  if (content.type === "text") {
                    const textContent = typeof content.text === 'string'
                      ? content.text
                      : (content.text?.text || JSON.stringify(content.text || content));

                    if (textContent.trim() === '') return null;
                    renderedSomething = true;

                    const systemInstructionContent = renderWithSystemInstructions(textContent, agents, `user-arr-${idx}-`);
                    if (systemInstructionContent) {
                      return <div key={idx}>{systemInstructionContent}</div>;
                    }

                    const textPresentation = getUserMessagePresentation({
                      type: 'user',
                      message: { content: [{ type: 'text', text: textContent }] },
                    });

                    if (textPresentation.collapsible) {
                      return (
                        <CollapsibleTextCard
                          key={idx}
                          title={textPresentation.title}
                          preview={textPresentation.preview}
                          {...getCardExpansionProps(`user-text-${idx}`, textPresentation.defaultExpanded)}
                        >
                          <div className="text-sm whitespace-pre-wrap">
                            {parseAgentMentions(textContent, agents)}
                          </div>
                        </CollapsibleTextCard>
                      );
                    }

                    return (
                      <div key={idx} className="text-sm whitespace-pre-wrap">
                        {parseAgentMentions(textContent, agents)}
                      </div>
                    );
                  }

                  // Tool result
                  if (content.type === "tool_result") {
                    // Skip duplicate tool_result if a dedicated widget is present
                    let hasCorrespondingWidget = false;
                    if (content.tool_use_id) {
                      const toolName = sharedStreamContext.toolUseNamesById.get(content.tool_use_id);
                      const toolsWithWidgets = ['task','edit','multiedit','todowrite','todoread','ls','read','glob','bash','write','grep','websearch','web_search','webfetch','agentoutputtool'];
                      if (toolName && (toolsWithWidgets.includes(toolName) || toolName.startsWith('mcp__'))) {
                        hasCorrespondingWidget = true;
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
                          <EditResultWidget content={contentText} {...getCardExpansionProps(`tool-result-${content.tool_use_id || idx}-edit`, false)} />
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
                      if (sharedStreamContext.toolUseNamesById.get(content.tool_use_id) !== 'ls') return false;

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
                      const filePath = sharedStreamContext.readToolPathsById.get(content.tool_use_id);

                      renderedSomething = true;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">Read Result</span>
                          </div>
                          <ReadResultWidget content={contentText} filePath={filePath} workspacePath={cwd} {...getCardExpansionProps(`tool-result-${content.tool_use_id || idx}-read`, false)} />
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
                    const toolResultExpansion = getCardExpansionProps(`tool-result-${content.tool_use_id || idx}`, false);
                    const isExpanded = Boolean(toolResultExpansion.expanded);
                    const toggleExpanded = () => toolResultExpansion.onExpandedChange?.(!isExpanded);

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

    // Error message - display error to user
    if (message.type === "error") {
      return <ErrorMessageCard message={message} className={className} />;
    }

    // Result message - render with markdown
    if (message.type === "result") {
      const resultExpansion = getCardExpansionProps('result-details', false);
      return (
        <ResultMessageCard
          message={message}
          runtimeSummary={runtimeSummary}
          syntaxTheme={syntaxTheme}
          className={className}
          expansion={resultExpansion}
        />
      );
    }

    if (runtimeSummary) {
      const eventDetails = formatEventDetails(message);
      const eventLabel = [message.type, message.subtype].filter(Boolean).join(' · ') || 'runtime event';
      return (
        <RuntimeEventCard
          runtimeSummary={runtimeSummary}
          eventDetails={eventDetails}
          eventLabel={eventLabel}
          className={className}
          expansion={getCardExpansionProps('event-details', false)}
        />
      );
    }

    // Skip rendering if no meaningful content
    return null;
  } catch (error) {
    // If any error occurs during rendering, show a safe error message
    console.error("Error rendering stream message:", error, message);
    return <RenderFailureCard error={error} />;
  }
};

export const StreamMessage = React.memo(StreamMessageComponent, streamMessagePropsAreEqual);
