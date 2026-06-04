import React, { useCallback, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import type { ClaudeStreamMessage } from '../types';

interface CopyConversationMenuProps {
  messages: ClaudeStreamMessage[];
  projectPath: string;
}

export function CopyConversationMenu({ messages, projectPath }: CopyConversationMenuProps): React.ReactNode {
  const [open, setOpen] = useState(false);

  const handleCopyAsJsonl = useCallback(async () => {
    const jsonl = messages.map((message) => JSON.stringify(message)).join('\n');
    await navigator.clipboard.writeText(jsonl);
    setOpen(false);
  }, [messages]);

  const handleCopyAsMarkdown = useCallback(async () => {
    await navigator.clipboard.writeText(formatConversationAsMarkdown(messages, projectPath));
    setOpen(false);
  }, [messages, projectPath]);

  return useMemo(() => {
    if (messages.length === 0) {
      return undefined;
    }

    return (
      <Popover
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground active:scale-[0.97]"
            title="Copy conversation"
            aria-label="Copy conversation"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        }
        content={
          <div className="w-44 p-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyAsMarkdown}
              className="w-full justify-start text-xs"
            >
              Copy as Markdown
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyAsJsonl}
              className="w-full justify-start text-xs"
            >
              Copy as JSONL
            </Button>
          </div>
        }
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
      />
    );
  }, [handleCopyAsJsonl, handleCopyAsMarkdown, messages.length, open]);
}

function formatConversationAsMarkdown(messages: ClaudeStreamMessage[], projectPath: string): string {
  let markdown = '# AI Code Session\n\n';
  markdown += `**Project:** ${projectPath}\n`;
  markdown += `**Date:** ${new Date().toISOString()}\n\n`;
  markdown += '---\n\n';

  for (const message of messages) {
    markdown += formatMessageAsMarkdown(message);
  }

  return markdown;
}

function formatMessageAsMarkdown(message: ClaudeStreamMessage): string {
  if (message.type === 'system' && message.subtype === 'init') {
    return formatSystemInitMessage(message);
  }

  if (message.type === 'assistant' && message.message) {
    return formatAssistantMessage(message);
  }

  if (message.type === 'user' && message.message) {
    return formatUserMessage(message);
  }

  if (message.type === 'result') {
    return formatResultMessage(message);
  }

  return '';
}

function formatSystemInitMessage(message: ClaudeStreamMessage): string {
  let markdown = '## System Initialization\n\n';
  markdown += `- Session ID: \`${message.session_id || 'N/A'}\`\n`;
  markdown += `- Model: \`${message.model || 'default'}\`\n`;

  if (message.cwd) {
    markdown += `- Working Directory: \`${message.cwd}\`\n`;
  }

  if (message.tools?.length) {
    markdown += `- Tools: ${message.tools.join(', ')}\n`;
  }

  return `${markdown}\n`;
}

function formatAssistantMessage(message: ClaudeStreamMessage): string {
  let markdown = '## Assistant\n\n';

  for (const content of message.message?.content || []) {
    if (content.type === 'text') {
      markdown += `${textBlockValue(content.text, content)}\n\n`;
    } else if (content.type === 'tool_use') {
      markdown += `### Tool: ${content.name}\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(content.input, null, 2)}\n\`\`\`\n\n`;
    }
  }

  if (message.message?.usage) {
    markdown += `*Tokens: ${message.message.usage.input_tokens} in, ${message.message.usage.output_tokens} out*\n\n`;
  }

  return markdown;
}

function formatUserMessage(message: ClaudeStreamMessage): string {
  let markdown = '## User\n\n';

  for (const content of message.message?.content || []) {
    if (content.type === 'text') {
      markdown += `${textBlockValue(content.text)}\n\n`;
    } else if (content.type === 'tool_result') {
      markdown += '### Tool Result\n\n';
      markdown += `\`\`\`\n${toolResultContentText(content.content)}\n\`\`\`\n\n`;
    }
  }

  return markdown;
}

function formatResultMessage(message: ClaudeStreamMessage): string {
  let markdown = '## Execution Result\n\n';

  if (message.result) {
    markdown += `${message.result}\n\n`;
  }

  if (message.error) {
    markdown += `**Error:** ${message.error}\n\n`;
  }

  return markdown;
}

function textBlockValue(text: any, fallback?: unknown): string {
  if (typeof text === 'string') {
    return text;
  }

  return text?.text || JSON.stringify(text || fallback);
}

function toolResultContentText(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  if (content.text) {
    return content.text;
  }

  if (Array.isArray(content)) {
    return content
      .map((item: any) => (typeof item === 'string' ? item : item.text || JSON.stringify(item)))
      .join('\n');
  }

  return JSON.stringify(content, null, 2);
}
