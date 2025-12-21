import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface TerminalOutput {
  id: string;
  type: 'command' | 'output' | 'error';
  content: string;
  timestamp: Date;
}

interface TerminalPaneProps {
  outputs: TerminalOutput[];
  isRunning?: boolean;
  workspacePath?: string;
  className?: string;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  outputs,
  isRunning = false,
  workspacePath: _workspacePath, // 保留以备将来使用
  className
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto scroll to bottom when new output arrives
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputs]);

  return (
    <ScrollArea className={cn("flex-1 h-full", className)}>
      <div ref={scrollRef} className="p-4 space-y-2 font-mono text-sm">
        {outputs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <p className="text-xs">Enter a command to start using the terminal</p>
            </div>
          </div>
        ) : (
          outputs.map((output) => (
            <div key={output.id} className="space-y-1">
              {output.type === 'command' && (
                <div className="flex items-start gap-2">
                  <span className="text-primary">$</span>
                  <span className="text-primary/80">{output.content}</span>
                </div>
              )}
              {output.type === 'output' && (
                <div className="pl-4 text-foreground/80 whitespace-pre-wrap break-words">
                  {output.content}
                </div>
              )}
              {output.type === 'error' && (
                <div className="pl-4 text-destructive whitespace-pre-wrap break-words">
                  {output.content}
                </div>
              )}
            </div>
          ))
        )}
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
            <span className="text-xs">Running...</span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
