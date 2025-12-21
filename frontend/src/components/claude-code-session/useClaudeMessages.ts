import { useState, useCallback, useRef, useEffect } from 'react';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';
import { api } from '@/lib/api';
import type { ClaudeStreamMessage } from '../AgentExecution';

interface UseClaudeMessagesOptions {
  onSessionInfo?: (info: { sessionId: string; projectId: string }) => void;
  onTokenUpdate?: (tokens: number) => void;
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
}

export function useClaudeMessages(options: UseClaudeMessagesOptions = {}) {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const eventListenerSetupRef = useRef<boolean>(false);
  const accumulatedContentRef = useRef<{ [key: string]: string }>({});

  const handleMessage = useCallback((message: ClaudeStreamMessage) => {
    if ((message as any).type === "start") {
      // Clear accumulated content for new stream
      accumulatedContentRef.current = {};
      setIsStreaming(true);
      options.onStreamingChange?.(true, currentSessionId);
    } else if ((message as any).type === "partial") {
      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((toolCall: any) => {
          if (toolCall.content && toolCall.partial_tool_call_index !== undefined) {
            const key = `tool-${toolCall.partial_tool_call_index}`;
            if (!accumulatedContentRef.current[key]) {
              accumulatedContentRef.current[key] = "";
            }
            accumulatedContentRef.current[key] += toolCall.content;
            toolCall.accumulated_content = accumulatedContentRef.current[key];
          }
        });
      }
    } else if ((message as any).type === "response" && message.message?.usage) {
      const totalTokens = (message.message.usage.input_tokens || 0) + 
                         (message.message.usage.output_tokens || 0);
      options.onTokenUpdate?.(totalTokens);
    } else if ((message as any).type === "error" || (message as any).type === "response") {
      setIsStreaming(false);
      options.onStreamingChange?.(false, currentSessionId);
    }

    setMessages(prev => [...prev, message]);

    // Extract session info
    if ((message as any).type === "session_info" && (message as any).session_id && (message as any).project_id) {
      options.onSessionInfo?.({
        sessionId: (message as any).session_id,
        projectId: (message as any).project_id
      });
      setCurrentSessionId((message as any).session_id);
    }
  }, [currentSessionId, options]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    accumulatedContentRef.current = {};
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const output = await api.getSessionOutput(parseInt(sessionId));
      // Note: API returns a string, not an array of outputs
      const outputs = [{ jsonl: output }];
      const loadedMessages: ClaudeStreamMessage[] = [];

      outputs.forEach(output => {
        if (output.jsonl) {
          const lines = output.jsonl.split('\n').filter(line => line.trim());
          lines.forEach(line => {
            try {
              const msg = JSON.parse(line);
              loadedMessages.push(msg);
            } catch (e) {
              console.error("Failed to parse JSONL:", e);
            }
          });
        }
      });

      setMessages(loadedMessages);
    } catch (error) {
      console.error("Failed to load session outputs:", error);
      throw error;
    }
  }, []);

  // Set up event listener
  useEffect(() => {
    // Prevent duplicate event listeners
    if (eventListenerSetupRef.current) {
      return;
    }

    eventListenerSetupRef.current = true;

    // Set up Wails event listener
    EventsOn("claude-stream", (data: string) => {
      try {
        const message = JSON.parse(data) as ClaudeStreamMessage;
        handleMessage(message);
      } catch (error) {
        console.error("Failed to parse Claude stream message:", error);
      }
    });

    return () => {
      EventsOff("claude-stream");
      eventListenerSetupRef.current = false;
    };
  }, [handleMessage]);

  return {
    messages,
    isStreaming,
    currentSessionId,
    clearMessages,
    loadMessages,
    handleMessage
  };
}