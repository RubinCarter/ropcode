import React, { useCallback } from 'react';
import { MessageSquare, MessageSquarePlus, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProviderSessionSummary } from '@/lib/api';
import { useTabContext } from '@/contexts/TabContext';
import { cn } from '@/lib/utils';
import { ClaudeIcon } from '@/components/icons/ClaudeIcon';
import { OpenAIIcon } from '@/components/icons/OpenAIIcon';
import { GeminiIcon } from '@/components/icons/GeminiIcon';
import { useSpaceSessions } from './useSpaceSessions';

interface SessionPanelProps {
  selectedSpacePath: string | null;
  selectedSpaceLabel: string | null;
  selectedProjectLabel?: string | null;
  onSwitchToWorkspace: (spacePath: string) => void;
}

const formatTimeAgo = (timestamp: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
};

const getSessionTitle = (session: ProviderSessionSummary): string => {
  const title = session.title || session.first_message;
  if (title?.trim()) return title.trim();
  return `${session.provider} session`;
};

const getProviderLabel = (provider: string): string => {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return provider;
};

const getProviderIcon = (provider: string) => {
  if (provider === 'claude') return ClaudeIcon;
  if (provider === 'codex') return OpenAIIcon;
  if (provider === 'gemini') return GeminiIcon;
  return MessageSquare;
};

export const SessionPanel: React.FC<SessionPanelProps> = ({
  selectedSpacePath,
  selectedSpaceLabel,
  selectedProjectLabel,
  onSwitchToWorkspace,
}) => {
  const { tabs, setActiveTab, updateTab } = useTabContext();

  const activeTabUpdater = useCallback((sessionId: string, title: string) => {
    const matchingTab = tabs.find(tab =>
      tab.type === 'chat' &&
      tab.sessionId === sessionId
    );
    if (matchingTab) {
      updateTab(matchingTab.id, { title });
    }
  }, [tabs, updateTab]);

  const {
    sessions,
    loading,
    error,
    loadedAll,
    hasMore,
    runningSessionIds,
    regeneratingSessionTitles,
    loadMore,
    refresh,
    regenerateTitle,
  } = useSpaceSessions({
    spacePath: selectedSpacePath,
    activeTabUpdater,
  });

  const openSession = (session: ProviderSessionSummary) => {
    if (!selectedSpacePath) return;

    const existingTab = tabs.find(tab =>
      tab.type === 'chat' &&
      tab.projectPath === selectedSpacePath &&
      tab.sessionId === session.id &&
      tab.providerId === session.provider
    );
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }

    onSwitchToWorkspace(selectedSpacePath);
    (window as any).__ROPCODE_PENDING_PROVIDER_SESSION__ = { spacePath: selectedSpacePath, session };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-provider-session', {
        detail: { spacePath: selectedSpacePath, session },
      }));
    }, 0);
  };

  const openNewSession = () => {
    if (!selectedSpacePath) return;

    onSwitchToWorkspace(selectedSpacePath);
    (window as any).__ROPCODE_PENDING_NEW_SESSION__ = { spacePath: selectedSpacePath };
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-new-session', {
        detail: { spacePath: selectedSpacePath },
      }));
    }, 0);
  };

  if (!selectedSpacePath) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border/50 px-3 py-3">
          <div className="text-sm font-medium">Sessions</div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
          <MessageSquare className="mb-3 h-6 w-6 text-muted-foreground" />
          <p>Select a project or workspace first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{selectedSpaceLabel || 'Sessions'}</div>
          {selectedProjectLabel && selectedProjectLabel !== selectedSpaceLabel && (
            <div className="truncate text-[11px] text-muted-foreground">{selectedProjectLabel}</div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => refresh(true)}
          aria-label="Refresh sessions"
          title="Refresh sessions"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={openNewSession}
          aria-label="New session"
          title="New session"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && sessions.length === 0 && (
          <div className="space-y-1">
            {[0, 1, 2, 3].map(index => (
              <div key={index} className="h-8 animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md px-2 py-2 text-xs text-destructive">
            <div className="truncate" title={error}>Failed to load sessions</div>
            <button
              type="button"
              className="mt-1 text-muted-foreground hover:text-foreground"
              onClick={() => refresh(true)}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No sessions yet.
          </div>
        )}

        <div className="space-y-0.5">
          {sessions.map((session) => {
            const ProviderIcon = getProviderIcon(session.provider);
            const sessionKey = `${session.provider}:${session.id}`;
            const isRunning = session.is_running || runningSessionIds.has(sessionKey);
            const isRegenerating = regeneratingSessionTitles.has(sessionKey);

            return (
              <div
                key={sessionKey}
                className="group/session flex items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-accent/50"
              >
                <button
                  type="button"
                  onClick={() => openSession(session)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left hover:text-foreground"
                  title={`${getProviderLabel(session.provider)} · ${getSessionTitle(session)}`}
                >
                  <span className="relative inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    <ProviderIcon className="h-3.5 w-3.5" />
                    {isRunning && (
                      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 ring-1 ring-background" />
                    )}
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate', isRegenerating && 'animate-title-generating')}>
                    {isRegenerating ? 'Generating...' : getSessionTitle(session)}
                  </span>
                  <span className="flex-shrink-0 text-[10px]">{formatTimeAgo(session.last_activity)}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isRegenerating) regenerateTitle(session);
                  }}
                  disabled={isRegenerating}
                  className={cn(
                    'mr-1 flex-shrink-0 rounded p-1 transition-all hover:bg-accent',
                    isRegenerating ? 'opacity-100 text-primary' : 'opacity-0 group-hover/session:opacity-100'
                  )}
                  title="Summarize current focus and rename this session"
                  aria-label={`Rename session ${getSessionTitle(session)}`}
                >
                  <Sparkles className={cn('h-3 w-3', isRegenerating && 'animate-pulse text-primary')} />
                </button>
              </div>
            );
          })}
        </div>

        {hasMore && !loadedAll && (
          <button
            type="button"
            onClick={loadMore}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            More
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionPanel;
