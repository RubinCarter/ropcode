import React, { Suspense, lazy, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTabState } from '@/hooks/useTabState';
import { useScreenTracking } from '@/hooks/useAnalytics';
import { Tab } from '@/contexts/TabContext';
import { Loader2 } from 'lucide-react';
import { shouldKeepTabMounted } from '@/lib/tabUtils';
import { MCPManager } from '@/components/MCPManager';
import { SettingsLoadingShell } from '@/components/SettingsLoadingShell';

const loadSettings = () => {
  console.info('[settings] loading Settings chunk');
  return import('@/components/Settings')
    .then(m => {
      console.info('[settings] Settings chunk loaded');
      return { default: m.Settings };
    })
    .catch(error => {
      console.error('[settings] Settings chunk failed', error);
      throw error;
    });
};

const scheduleSettingsPrefetch = () => {
  const win = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof win.requestIdleCallback === 'function') {
    const idleId = win.requestIdleCallback(() => {
      void loadSettings().catch(() => undefined);
    }, { timeout: 1500 });
    return () => win.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(() => {
    void loadSettings().catch(() => undefined);
  }, 600);
  return () => globalThis.clearTimeout(timeoutId);
};

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));
const Settings = lazy(loadSettings);
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer'));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const CreateAgent = lazy(() => import('@/components/CreateAgent').then(m => ({ default: m.CreateAgent })));
const UsageDashboard = lazy(() => import('@/components/UsageDashboard').then(m => ({ default: m.UsageDashboard })));
const MarkdownEditor = lazy(() => import('@/components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewWidget = lazy(() => import('@/components/WebViewWidget').then(m => ({ default: m.WebViewWidget })));
// const ClaudeFileEditor = lazy(() => import('@/components/ClaudeFileEditor').then(m => ({ default: m.ClaudeFileEditor })));

// Import non-lazy components for projects view

interface TabPanelProps {
  tab: Tab;
  isActive: boolean;
}

const TabPanel: React.FC<TabPanelProps> = React.memo(({ tab, isActive }) => {
  const { updateTab, closeTab } = useTabState();

  // Performance: determine if tab should stay mounted
  const keepMounted = shouldKeepTabMounted(tab.type);

  // Track screen when tab becomes active
  useScreenTracking(isActive ? tab.type : undefined, isActive ? tab.id : undefined);

  // Monitor component lifecycle (removed for production)
  useEffect(() => {
    return () => {
      if (!keepMounted) {
        // Component unmount notification can be logged here if needed
      }
    };
  }, [keepMounted]);

  useEffect(() => {
    if (tab.type !== 'settings' || !isActive) return;
    return scheduleSettingsPrefetch();
  }, [isActive, tab.type]);

  // Handle provider change - reload sessions for the new provider
  const handleProviderChange = async (providerId: string) => {
    updateTab(tab.id, { providerId });
  };

  // Performance: conditional render vs CSS hidden
  // For stateless tabs, return null when inactive (unmount component)
  if (!isActive && !keepMounted) {
    return null;
  }

  // For stateful tabs, use CSS hidden to control visibility
  const panelVisibilityClass = isActive ? "" : "hidden";

  const renderContent = () => {
    switch (tab.type) {
      case 'chat':
        return (
          <div className="h-full w-full flex flex-col pt-4">
            <AiCodeSession
              key={tab.id}
              session={tab.sessionData} // Pass the full session object if available
              initialProjectPath={tab.initialProjectPath || tab.sessionData?.project_path || tab.sessionData?.project_id || undefined}
              defaultProvider={tab.providerId || "claude"}
              skipSessionRestore={tab.skipSessionRestore}
              projectChatId={tab.projectChatId}
              onBack={() => {
                // Close current tab - projects are in sidebar
                closeTab(tab.id);
              }}
              onProjectPathChange={(_path: string) => {
                // Don't update tab title - keep it as "Chat"
              }}
              onProviderChange={handleProviderChange}
            />
          </div>
        );

      case 'agent':
        if (!tab.agentRunId) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4">No agent run ID specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <AgentRunOutputViewer
              agentRunId={tab.agentRunId}
              tabId={tab.id}
            />
          </div>
        );

      case 'agents':
        return (
          <div className="h-full w-full flex flex-col">
            <Agents />
          </div>
        );

      case 'usage':
        return (
          <div className="h-full w-full flex flex-col">
            <UsageDashboard onBack={() => {}} />
          </div>
        );

      case 'mcp':
        return (
          <div className="h-full w-full flex flex-col">
            <MCPManager onBack={() => {}} />
          </div>
        );

      case 'settings':
        return (
          <div className="h-full w-full flex flex-col">
            <Settings onBack={() => {}} />
          </div>
        );

      case 'claude-md':
        return (
          <div className="h-full w-full flex flex-col">
            <MarkdownEditor onBack={() => {}} />
          </div>
        );

      case 'diff':
        // Support both filePath and diffFilePath field names (backward compat)
        const diffPath = tab.diffFilePath || tab.filePath;
        if (!diffPath || !tab.projectPath) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4 text-muted-foreground">No file path or project path specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <DiffViewer
              filePath={diffPath}
              workspacePath={tab.projectPath}
              gitStatus={tab.gitStatus}
            />
          </div>
        );

      case 'file':
        if (!tab.filePath || !tab.projectPath) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4 text-muted-foreground">No file path or project path specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <FileViewer
              filePath={tab.filePath}
              workspacePath={tab.projectPath}
              onUnsavedChangesChange={(hasChanges) => {
                updateTab(tab.id, { hasUnsavedChanges: hasChanges });
              }}
            />
          </div>
        );

      case 'webview':
        if (!tab.webviewUrl) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4 text-muted-foreground">No URL specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <WebViewWidget
              url={tab.webviewUrl}
              workspacePath={tab.projectPath}
              onUrlChange={(newUrl) => {
                // Update tab's URL when user navigates
                updateTab(tab.id, { webviewUrl: newUrl });
              }}
            />
          </div>
        );

      case 'claude-file':
        if (!tab.claudeFileId) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4">No Claude file ID specified</div>
            </div>
          );
        }
        // Note: We need to get the actual file object for ClaudeFileEditor
        // For now, returning a placeholder
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div className="p-4">Claude file editor not yet implemented in tabs</div>
          </div>
        );

      case 'agent-execution':
        if (!tab.agentData) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4">No agent data specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <AgentExecution
              agent={tab.agentData}
              projectPath={tab.projectPath}
              tabId={tab.id}
              onBack={() => {}}
            />
          </div>
        );

      case 'create-agent':
        return (
          <div className="h-full w-full flex flex-col">
            <CreateAgent
              onAgentCreated={() => {
                // Close this tab after agent is created
                window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: tab.id } }));
              }}
              onBack={() => {
                // Close this tab when back is clicked
                window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: tab.id } }));
              }}
            />
          </div>
        );

      case 'import-agent':
        // TODO: Implement import agent component
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div className="p-4">Import agent functionality coming soon...</div>
          </div>
        );

      default:
        return (
          <div className="h-full w-full flex items-center justify-center">
            <div className="p-4">Unknown tab type: {tab.type}</div>
          </div>
        );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className={`h-full w-full flex flex-col ${panelVisibilityClass}`}
    >
      <Suspense
        fallback={
          tab.type === 'settings' ? (
            <SettingsLoadingShell />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )
        }
      >
        {renderContent()}
      </Suspense>
    </motion.div>
  );
}, (prevProps, nextProps) => {
  const keepMounted = shouldKeepTabMounted(nextProps.tab.type);

  // Performance: fine-grained comparison logic
  if (!keepMounted) {
    // Stateless tab: simple comparison
    return prevProps.tab.id === nextProps.tab.id &&
           prevProps.isActive === nextProps.isActive;
  } else {
    // Stateful tab: needs deeper property comparison
    return prevProps.tab.id === nextProps.tab.id &&
           prevProps.isActive === nextProps.isActive &&
           prevProps.tab.sessionData?.id === nextProps.tab.sessionData?.id &&
           prevProps.tab.providerId === nextProps.tab.providerId &&
           prevProps.tab.projectChatId === nextProps.tab.projectChatId;
  }
});

export const TabContent: React.FC = () => {
  const { tabs, activeTabId, createClaudeFileTab, createAgentExecutionTab, createCreateAgentTab, createImportAgentTab, closeTab } = useTabState();

  // Listen for events to open other tab types (but not sessions directly)
  useEffect(() => {
    // Removed handleOpenSessionInTab and handleClaudeSessionSelected - only sidebar can create chat tabs

    const handleOpenClaudeFile = (event: CustomEvent) => {
      const { file } = event.detail;
      createClaudeFileTab(file.id, file.name || 'CLAUDE.md');
    };

    const handleOpenAgentExecution = (event: CustomEvent) => {
      const { agent, tabId, projectPath } = event.detail;
      createAgentExecutionTab(agent, tabId, projectPath);
    };

    const handleOpenCreateAgentTab = () => {
      createCreateAgentTab();
    };

    const handleOpenImportAgentTab = () => {
      createImportAgentTab();
    };

    const handleCloseTab = (event: CustomEvent) => {
      const { tabId } = event.detail;
      closeTab(tabId);
    };

    // Removed 'open-session-in-tab' and 'claude-session-selected' event listeners
    window.addEventListener('open-claude-file', handleOpenClaudeFile as EventListener);
    window.addEventListener('open-agent-execution', handleOpenAgentExecution as EventListener);
    window.addEventListener('open-create-agent-tab', handleOpenCreateAgentTab);
    window.addEventListener('open-import-agent-tab', handleOpenImportAgentTab);
    window.addEventListener('close-tab', handleCloseTab as EventListener);
    return () => {
      window.removeEventListener('open-claude-file', handleOpenClaudeFile as EventListener);
      window.removeEventListener('open-agent-execution', handleOpenAgentExecution as EventListener);
      window.removeEventListener('open-create-agent-tab', handleOpenCreateAgentTab);
      window.removeEventListener('open-import-agent-tab', handleOpenImportAgentTab);
      window.removeEventListener('close-tab', handleCloseTab as EventListener);
    };
  }, [createClaudeFileTab, createAgentExecutionTab, createCreateAgentTab, createImportAgentTab, closeTab]);
  
  return (
    <div className="flex-1 h-full relative">
      <AnimatePresence>
        {tabs.map((tab) => {
          // Generate a unique key that includes type-specific identifiers
          // This ensures React remounts the component when content changes
          let key = `${tab.id}-${tab.type}`;
          if (tab.type === 'diff' && tab.diffFilePath) {
            key += `-${tab.diffFilePath}`;
          } else if (tab.type === 'file' && tab.filePath) {
            key += `-${tab.filePath}`;
          } else if (tab.type === 'webview' && tab.webviewUrl) {
            key += `-${tab.webviewUrl}`;
          } else if (tab.type === 'claude-file' && tab.claudeFileId) {
            key += `-${tab.claudeFileId}`;
          }

          return (
            <TabPanel
              key={key}
              tab={tab}
              isActive={tab.id === activeTabId}
            />
          );
        })}
      </AnimatePresence>
      
      {tabs.length === 0 && (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <p className="text-lg mb-2">No tabs open</p>
            <p className="text-sm">Select a project from the sidebar to get started</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabContent;
