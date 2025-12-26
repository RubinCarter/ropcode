import React from 'react';
import { Play, Loader2, Settings, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Action } from '@/lib/api';

interface RunTabPaneProps {
  actions: Action[];
  onExecute: (action: Action) => void;
  runningActionId?: string;
  isTerminalRunning?: boolean;
  className?: string;
  onActionsConfig?: () => void;
  onOpenWebView?: () => void;
}

export const RunTabPane: React.FC<RunTabPaneProps> = ({
  actions,
  onExecute,
  runningActionId,
  isTerminalRunning = false,
  className,
  onActionsConfig,
  onOpenWebView
}) => {
  return (
    <ScrollArea className={cn("flex-1 h-full", className)}>
      <div className="p-4 space-y-2">
        {/* 顶部按钮区 */}
        <div className="flex gap-2">
          {/* 打开浏览器按钮 */}
          {onOpenWebView && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenWebView}
              className={cn(
                "flex-1 h-10 flex items-center justify-center gap-2",
                "border-green-500/30 bg-green-500/5",
                "hover:bg-green-500/10 hover:border-green-500/50 transition-colors"
              )}
            >
              <Globe className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm">Open Browser</span>
            </Button>
          )}

          {/* Actions Configure 按钮 */}
          {onActionsConfig && (
            <Button
              variant="outline"
              size="sm"
              onClick={onActionsConfig}
              className={cn(
                "flex-1 h-10 flex items-center justify-center gap-2",
                "border-dashed",
                "hover:bg-primary/5 hover:border-primary/50 transition-colors",
                "text-muted-foreground hover:text-foreground"
              )}
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm">Configure Actions</span>
            </Button>
          )}
        </div>

        {/* Actions 列表 */}
        {actions.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Play className="h-8 w-8 mx-auto opacity-50 mb-2" />
            <p className="text-sm">No actions configured</p>
            <p className="text-xs mt-1">Click "Configure Actions" to add some</p>
          </div>
        ) : (
          actions.map((action) => {
            const isRunning = runningActionId === action.id;
            const actionType = action.actionType || 'script'; // 默认为 script
            const isWebAction = actionType === 'web';

            // 根据 actionType 选择图标
            const ActionIcon = isWebAction ? Globe : Play;
            const Icon = isRunning ? Loader2 : ActionIcon;

            // 显示内容统一使用 command 字段
            const displayContent = action.command;

            return (
              <Button
                key={action.id}
                variant="outline"
                size="lg"
                onClick={() => onExecute(action)}
                disabled={isRunning || (isTerminalRunning && !isWebAction)}
                className={cn(
                  "w-full h-auto min-h-[60px] flex flex-col items-start gap-2 p-4",
                  "hover:bg-muted/50 transition-colors",
                  // Web action 添加特殊样式
                  actionType === 'web' && "border-green-500/30 bg-green-500/5"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <Icon className={cn("h-4 w-4", isRunning && "animate-spin")} />
                  <span className="font-medium text-sm">{action.name}</span>
                  {actionType === 'web' && (
                    <span className="ml-auto px-2 py-0.5 text-xs bg-green-500/20 text-green-600 dark:text-green-400 rounded">
                      Web
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono text-left w-full truncate">
                  {displayContent}
                </div>
              </Button>
            );
          })
        )}
      </div>
    </ScrollArea>
  );
};
