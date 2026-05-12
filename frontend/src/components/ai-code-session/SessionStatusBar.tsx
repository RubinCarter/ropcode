import React from 'react';
import { AlertCircle, Bot, Brain, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, RefreshCw, Sparkles, Wrench, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { QueuedPrompt } from './types';
import type { SessionStatusBarModel, SessionStatusGlyph, SessionStatusTone } from './utils/sessionStatusBarPresentation';

interface SessionStatusBarProps {
  model: SessionStatusBarModel;
  className?: string;
  queuedPrompts?: QueuedPrompt[];
  queueCollapsed?: boolean;
  onQueueCollapsedChange?: (collapsed: boolean) => void;
  onRemoveQueuedPrompt?: (id: string) => void;
}

const glyphIcon: Record<SessionStatusGlyph, React.ElementType> = {
  idle: Bot,
  thinking: Brain,
  tool: Wrench,
  retry: RefreshCw,
  warning: AlertCircle,
  success: CheckCircle2,
  error: AlertCircle,
  reconnect: RefreshCw,
  subagents: Sparkles,
};

const toneClasses: Record<SessionStatusTone, string> = {
  neutral: 'border-border/70 bg-background/90',
  info: 'border-primary/20 bg-primary/5',
  success: 'border-green-500/20 bg-green-500/5',
  warning: 'border-amber-500/25 bg-amber-500/10',
  error: 'border-destructive/30 bg-destructive/10',
};

const iconClasses: Record<SessionStatusTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-primary',
  success: 'text-green-500',
  warning: 'text-amber-500',
  error: 'text-destructive',
};

export const SessionStatusBar: React.FC<SessionStatusBarProps> = ({
  model,
  className,
  queuedPrompts = [],
  queueCollapsed = false,
  onQueueCollapsedChange,
  onRemoveQueuedPrompt,
}) => {
  const Icon = glyphIcon[model.glyph];
  const { highMetrics, otherMetrics, visibleHints, lowHint } = React.useMemo(() => {
    const highMetrics = [] as typeof model.metrics;
    const otherMetrics = [] as typeof model.metrics;
    const visibleHints = [] as typeof model.hints;
    let lowHint: typeof model.hints[number] | undefined;

    for (const metric of model.metrics) {
      if (metric.priority === 'high') {
        highMetrics.push(metric);
      } else {
        otherMetrics.push(metric);
      }
    }

    for (const hint of model.hints) {
      if (hint.priority === 'low') {
        lowHint ??= hint;
      } else if (visibleHints.length < 2) {
        visibleHints.push(hint);
      }
    }

    return { highMetrics, otherMetrics, visibleHints, lowHint };
  }, [model.metrics, model.hints]);
  const hasQueuedPrompts = queuedPrompts.length > 0;

  return (
    <div className={cn('mx-auto w-full max-w-6xl px-4 pt-3', className)}>
      <div className={cn('rounded-xl border px-3 py-2.5 shadow-sm transition-colors contain-paint', toneClasses[model.tone])}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-background/80 border">
              {model.isActive && model.glyph !== 'success' && model.glyph !== 'error' ? (
                <Loader2 className={cn('h-3.5 w-3.5 animate-spin', iconClasses[model.tone])} />
              ) : (
                <Icon className={cn('h-3.5 w-3.5', iconClasses[model.tone])} />
              )}
              {model.isActive && model.glyph === 'subagents' && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium">{model.primary}</span>
                {highMetrics.map((metric) => (
                  <span key={metric.key} className="text-xs text-muted-foreground">
                    {metric.label}
                  </span>
                ))}
              </div>
              {model.secondary && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{model.secondary}</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
            {otherMetrics.slice(0, 4).map((metric) => (
              <Badge key={metric.key} variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
                {metric.label}
              </Badge>
            ))}
            <ModeBadge provider={model.mode.provider} model={model.mode.model} thinkingMode={model.mode.thinkingMode} />
            {visibleHints.map((hint) => (
              <Badge key={hint.key} variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                {hint.label}
              </Badge>
            ))}
            {visibleHints.length === 0 && lowHint && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {lowHint.label}
              </span>
            )}
          </div>
        </div>

        {hasQueuedPrompts && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                Queued Prompts ({queuedPrompts.length})
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onQueueCollapsedChange?.(!queueCollapsed)}
                aria-label={queueCollapsed ? 'Expand queued prompts' : 'Collapse queued prompts'}
              >
                {queueCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              </Button>
            </div>

            {!queueCollapsed && (
              <div className="mt-2 space-y-1.5">
                {queuedPrompts.map((queuedPrompt, index) => (
                  <div key={queuedPrompt.id} className="flex items-start gap-2 rounded-md bg-background/60 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          {formatModel(queuedPrompt.model) || queuedPrompt.model}
                        </span>
                      </div>
                      <p className="line-clamp-2 break-words text-sm">{queuedPrompt.prompt}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => onRemoveQueuedPrompt?.(queuedPrompt.id)}
                      aria-label="Remove queued prompt"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function ModeBadge({ provider, model, thinkingMode }: { provider: string; model?: string; thinkingMode?: string }) {
  const label = React.useMemo(() => {
    const parts = [formatProvider(provider), formatModel(model), formatThinkingMode(thinkingMode)].filter(Boolean);
    return parts.join(' · ');
  }, [provider, model, thinkingMode]);
  if (!label) return null;

  return (
    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
      <Zap className="mr-1 h-3 w-3 text-muted-foreground" />
      {label}
    </Badge>
  );
}

function formatProvider(provider: string): string {
  if (!provider) return '';
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  return provider;
}

function formatModel(model?: string): string {
  if (!model) return '';
  return model
    .replace(/^claude-/, '')
    .replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatThinkingMode(mode?: string): string {
  if (!mode) return '';
  if (mode === 'auto') return 'Auto';
  return mode.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
