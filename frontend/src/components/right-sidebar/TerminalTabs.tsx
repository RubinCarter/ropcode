import React from 'react';
import { X, Terminal, Plus, History, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface TerminalSession {
  id: string;
  title: string;
  type?: 'bash' | 'node' | 'python';
  isPty?: boolean;
}

interface TerminalTabsProps {
  sessions: TerminalSession[];
  activeSessionId?: string;
  onSelectSession?: (id: string) => void;
  onCloseSession?: (id: string) => void;
  onNewTerminal?: () => void;
  commandHistory?: string[];
  onSelectHistory?: (command: string) => void;
  className?: string;
  // 新增：Run tab 相关
  showRunTab?: boolean;
  onSelectRunTab?: () => void;
}

export const TerminalTabs: React.FC<TerminalTabsProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onNewTerminal,
  commandHistory = [],
  onSelectHistory,
  className,
  showRunTab = false,
  onSelectRunTab
}) => {

  return (
    <>
    <div className={cn(
      "flex items-center gap-1 px-2 py-1 border-b bg-background/50 overflow-x-auto scrollbar-thin",
      className
    )}>
      {/* Run Tab - 常驻在最前面 */}
      <div
        className={cn(
          "group flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer transition-colors",
          "hover:bg-muted/50",
          showRunTab && "bg-muted border border-border"
        )}
        onClick={onSelectRunTab}
      >
        <Play className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">Run</span>
      </div>

      {sessions.length > 0 && sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            "group flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer transition-colors",
            "hover:bg-muted/50",
            activeSessionId === session.id && "bg-muted border border-border"
          )}
          onClick={() => onSelectSession?.(session.id)}
        >
          <Terminal className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium max-w-[100px] truncate">
            {session.title}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession?.(session.id);
              }}
              title="关闭终端"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {/* 新建终端按钮 */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onNewTerminal}
        className="h-7 w-7 p-0 ml-1"
        title="新建终端"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>

      {/* 命令历史按钮 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Command History"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {commandHistory.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground text-center">
              No command history
            </div>
          ) : (
            commandHistory.slice(0, 10).map((cmd, idx) => (
              <DropdownMenuItem
                key={idx}
                onClick={() => onSelectHistory?.(cmd)}
                className="font-mono text-xs"
              >
                {cmd}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </>
  );
};
