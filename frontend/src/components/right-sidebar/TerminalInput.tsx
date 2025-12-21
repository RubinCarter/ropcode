import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TerminalInputProps {
  onSubmit?: (command: string) => void;
  commandHistory?: string[];
  placeholder?: string;
  disabled?: boolean;
  isRunning?: boolean;
  className?: string;
}

export const TerminalInput: React.FC<TerminalInputProps> = ({
  onSubmit,
  commandHistory = [],
  placeholder = 'Enter command...',
  disabled = false,
  isRunning = false,
  className
}) => {
  const [command, setCommand] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (command.trim() && !disabled) {
      onSubmit?.(command.trim());
      setCommand('');
      setHistoryIndex(-1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  };

  useEffect(() => {
    // Focus input when component mounts
    inputRef.current?.focus();
  }, []);

  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-3 border-t bg-background/80 backdrop-blur-sm",
      className
    )}>
      <span className="text-sm text-primary font-mono">$</span>
      <input
        ref={inputRef}
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex-1 bg-transparent text-sm font-mono outline-none",
          "placeholder:text-muted-foreground",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      />
      <div className="flex items-center gap-1">
        {commandHistory.length > 0 && !isRunning && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="Command history (↑)"
            disabled={disabled}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSubmit}
          disabled={!command.trim() || disabled || isRunning}
          className="h-6 w-6 p-0"
          title={isRunning ? "Running... (⌘C / Ctrl+C to stop)" : "Execute (Enter)"}
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};
