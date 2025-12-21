import React from 'react';
import { Plus, History, Settings, Terminal as TerminalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TerminalHeaderProps {
  onToggle?: () => void;
  onNewTerminal?: () => void;
  onSettings?: () => void;
  commandHistory?: string[];
  onSelectHistory?: (command: string) => void;
  workspaceName?: string;
  className?: string;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  onToggle,
  onNewTerminal,
  onSettings,
  commandHistory = [],
  onSelectHistory,
  workspaceName = '终端',
  className
}) => {
  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2 border-b bg-muted/30 backdrop-blur-sm",
      className
    )}>
      <div className="flex items-center gap-2">
        <TerminalIcon className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold truncate max-w-[200px]" title={workspaceName}>
          {workspaceName}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {/* 新建终端 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewTerminal}
          className="h-7 w-7 p-0"
          title="新建终端"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        {/* 命令历史 */}
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

        {/* 设置 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSettings}
          className="h-7 w-7 p-0"
          title="终端设置"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        {/* 折叠侧边栏 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="h-7 w-7 p-0"
          title="折叠侧边栏"
        >
          <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M2 1L1 2V14L2 15H14L15 14V2L14 1H2ZM2 14V2H9V14H2Z"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
};
