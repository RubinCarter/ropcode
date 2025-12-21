import React from 'react';
import { Play, Loader2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Action } from '@/lib/api';

interface ActionsBarProps {
  actions: Action[];
  onExecute: (action: Action) => void;
  runningActionId?: string;
  isTerminalRunning?: boolean;
  className?: string;
}

export const ActionsBar: React.FC<ActionsBarProps> = ({
  actions,
  onExecute,
  runningActionId,
  isTerminalRunning = false,
  className
}) => {
  if (actions.length === 0) return null;

  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-2 border-b bg-muted/10 overflow-x-auto",
      className
    )}>
      {actions.map((action) => {
        const isRunning = runningActionId === action.id;
        const actionType = action.actionType || 'script';
        const isWebAction = actionType === 'web';
        const Icon = isRunning ? Loader2 : (isWebAction ? Globe : Play);
        const tooltipText = action.command;

        return (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            onClick={() => onExecute(action)}
            disabled={isRunning || (isTerminalRunning && !isWebAction)}
            className="h-8 gap-1.5 px-3 whitespace-nowrap"
            title={tooltipText}
          >
            <Icon className={cn("h-4 w-4", isRunning && "animate-spin")} />
            <span className="text-xs">{action.name}</span>
          </Button>
        );
      })}
    </div>
  );
};
