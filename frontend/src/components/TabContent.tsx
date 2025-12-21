import React, { Suspense, lazy, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTabState } from '@/hooks/useTabState';
import { useTabContext } from '@/contexts/TabContext';
import { useScreenTracking } from '@/hooks/useAnalytics';
import { Tab } from '@/contexts/TabContext';
import { Loader2 } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { providers } from '@/lib/providers';
import { shouldKeepTabMounted } from '@/lib/tabUtils';

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer'));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const CreateAgent = lazy(() => import('@/components/CreateAgent').then(m => ({ default: m.CreateAgent })));
const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));
const UsageDashboard = lazy(() => import('@/components/UsageDashboard').then(m => ({ default: m.UsageDashboard })));
const MCPManager = lazy(() => import('@/components/MCPManager').then(m => ({ default: m.MCPManager })));
const Settings = lazy(() => import('@/components/Settings').then(m => ({ default: m.Settings })));
const MarkdownEditor = lazy(() => import('@/components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewer = lazy(() => import('@/components/WebViewer').then(m => ({ default: m.WebViewer })));
// const ClaudeFileEditor = lazy(() => import('@/components/ClaudeFileEditor').then(m => ({ default: m.ClaudeFileEditor })));

// Import non-lazy components for projects view

interface TabPanelProps {
  tab: Tab;
  isActive: boolean;
}

const TabPanel: React.FC<TabPanelProps> = React.memo(({ tab, isActive }) => {
  const { updateTab, closeTab } = useTabState();

  // 🚀 性能优化：判断是否需要保持挂载
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

  // Handle provider change - reload sessions for the new provider
  const handleProviderChange = async (providerId: string) => {

    if (tab.type !== 'chat' || !tab.initialProjectPath) {
      console.warn('[TabPanel] Cannot change provider: not a chat tab or no project path');
      return;
    }

    try {
      // Save current provider's session before switching
      const currentProviderSessions = tab.providerSessions || {};
      if (tab.providerId && tab.sessionId && tab.sessionData) {
        currentProviderSessions[tab.providerId] = {
          sessionId: tab.sessionId,
          sessionData: tab.sessionData
        };
      }

      // Get the actual project path - use sessionData if available, otherwise initialProjectPath
      const actualProjectPath = tab.sessionData?.project_path || tab.initialProjectPath;

      // Check if we have a previous session for this provider
      const previousSession = currentProviderSessions[providerId];

      if (previousSession) {
        // Restore previous session for this provider
        updateTab(tab.id, {
          providerId,
          sessionData: previousSession.sessionData,
          sessionId: previousSession.sessionId,
          providerSessions: currentProviderSessions,
        });
      } else {
        // No previous session - load sessions and pick the latest one
        try {
          const sessionList = await providers.listSessions(actualProjectPath, providerId);

          if (sessionList.length === 0) {
            // No sessions exist - clear current session and start fresh
            updateTab(tab.id, {
              providerId,
              sessionData: undefined,
              sessionId: undefined,
              providerSessions: currentProviderSessions,
            });
          } else {
            // Sort sessions by timestamp and select the latest one
            const sortedSessions = [...sessionList].sort((a, b) => {
              const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
              const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
              return timeB - timeA;
            });
            const latestSession = sortedSessions[0];

            // Add provider info to session
            const sessionWithProvider = {
              ...latestSession,
              provider: providerId
            };

            // Update tab with the latest session
            updateTab(tab.id, {
              providerId,
              sessionData: sessionWithProvider,
              sessionId: latestSession.id,
              providerSessions: currentProviderSessions,
            });
          }
        } catch (err) {
          console.error(`[TabPanel] Failed to load sessions for provider ${providerId}:`, err);
          // Fallback: start fresh
          updateTab(tab.id, {
            providerId,
            sessionData: undefined,
            sessionId: undefined,
            providerSessions: currentProviderSessions,
          });
        }
      }

      // Save the provider selection to project index
      try {
        await api.updateProjectLastProvider(actualProjectPath, providerId);
      } catch (err) {
        console.warn(`Failed to save last provider:`, err);
      }
    } catch (err) {
      console.error('[TabPanel] Failed to change provider:', err);
    }
  };

  // 🚀 性能优化：条件渲染 vs CSS hidden
  // 对于无状态的 Tab，非活动时直接返回 null（卸载组件）
  if (!isActive && !keepMounted) {
    return null;
  }

  // 对于有状态的 Tab，使用 CSS hidden 控制显示
  const panelVisibilityClass = isActive ? "" : "hidden";

  const renderContent = () => {
    switch (tab.type) {
      case 'chat':
        return (
          <div className="h-full w-full flex flex-col pt-4">
            <AiCodeSession
              key={`${tab.id}-${tab.providerId || 'claude'}`} // Force remount when provider changes
              session={tab.sessionData} // Pass the full session object if available
              initialProjectPath={tab.initialProjectPath || tab.sessionData?.project_path || tab.sessionData?.project_id || undefined}
              defaultProvider={tab.providerId || "claude"}
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
        if (!tab.diffFilePath || !tab.projectPath) {
          return (
            <div className="h-full w-full flex items-center justify-center">
              <div className="p-4 text-muted-foreground">No file path or project path specified</div>
            </div>
          );
        }
        return (
          <div className="h-full w-full flex flex-col">
            <DiffViewer
              filePath={tab.diffFilePath}
              workspacePath={tab.projectPath}
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
            <WebViewer
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
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {renderContent()}
      </Suspense>
    </motion.div>
  );
}, (prevProps, nextProps) => {
  const keepMounted = shouldKeepTabMounted(nextProps.tab.type);

  // 🚀 性能优化：精细化比较逻辑
  if (!keepMounted) {
    // 无状态 Tab：简单的比较
    return prevProps.tab.id === nextProps.tab.id &&
           prevProps.isActive === nextProps.isActive;
  } else {
    // 有状态 Tab：需要比较更深的属性
    return prevProps.tab.id === nextProps.tab.id &&
           prevProps.isActive === nextProps.isActive &&
           prevProps.tab.sessionData?.id === nextProps.tab.sessionData?.id &&
           prevProps.tab.providerId === nextProps.tab.providerId;
  }
});

export const TabContent: React.FC = () => {
  const { tabs, activeTabId, createChatTab, findTabByProjectPath, switchToTab, createClaudeFileTab, createAgentExecutionTab, createCreateAgentTab, createImportAgentTab, closeTab, updateTab } = useTabState();
  const { setCurrentWorkspace } = useTabContext();

  // Listen for sidebar project selection
  useEffect(() => {
    const handleSidebarProjectSelected = async (event: CustomEvent) => {
      const { project } = event.detail as { project: Project };

      try {
        // Set current workspace to this project
        setCurrentWorkspace(project.path);

        // Check if this project is already open in a tab
        const existingTab = findTabByProjectPath(project.path);
        if (existingTab) {
          // Project already open, switch to that tab
          switchToTab(existingTab.id);
          return;
        }

        // Update project access time
        try {
          await api.updateProjectAccessTime(project.id);
        } catch (accessTimeError) {
          console.warn('Failed to update project access time:', accessTimeError);
        }

        // Determine which provider to use based on last_provider
        const providerId = project.last_provider || 'claude';

        // Find the current provider info from project.providers array
        // This is crucial for checking if we have a saved session_id
        const currentProvider = (project as any).providers?.find(
          (p: any) => p.provider_id === providerId && p.path === project.path
        );

        console.log(`[TabContent] Opening project:`, {
          path: project.path,
          last_provider: project.last_provider,
          providerId: providerId,
          saved_session_id: currentProvider?.session_id,
          project: project
        });

        // Load sessions for this project using the last provider
        let sessionList: any[] = [];
        try {
          if (providerId === 'claude') {
            sessionList = await api.getProjectSessions(project.id);
          } else {
            // For other providers like codex, use provider-specific session listing
            sessionList = await providers.listSessions(project.path, providerId);
          }
        } catch (err) {
          console.warn(`Failed to load sessions for provider ${providerId}:`, err);
          sessionList = [];
        }

        // Determine which session to use
        let selectedSession: any = null;

        // 场景二：Priority - use saved session_id if available
        if (currentProvider?.session_id && sessionList.length > 0) {
          // Try to find the session matching the saved session_id
          selectedSession = sessionList.find(s => s.id === currentProvider.session_id);
          if (selectedSession) {
            console.log(`[TabContent] Using saved session_id: ${currentProvider.session_id}`);
          } else {
            console.warn(`[TabContent] Saved session_id ${currentProvider.session_id} not found in sessions, will use latest`);
          }
        }

        // 场景一：Fallback - select latest session if no saved session or saved session not found
        if (!selectedSession && sessionList.length > 0) {
          const sortedSessions = [...sessionList].sort((a, b) => {
            const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
            const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
            return timeB - timeA;
          });
          selectedSession = sortedSessions[0];
          console.log(`[TabContent] Selected latest session: ${selectedSession.id}`);

          // Save this session_id to projects.json for future use
          try {
            await api.updateProviderSession(project.path, providerId, selectedSession.id);
            console.log(`[TabContent] Saved new session_id to projects.json`);
          } catch (saveError) {
            console.warn('Failed to save session_id:', saveError);
          }
        }

        // Create tab based on selected session
        if (!selectedSession) {
          // No sessions exist - create a new chat tab with providerId at creation time
          createChatTab(undefined, 'Chat', project.path, providerId, undefined);
        } else {
          // Add provider info to session
          const sessionWithProvider = {
            ...selectedSession,
            provider: providerId
          };

          // Create new tab with the selected session, providerId, and sessionData at creation time
          createChatTab(selectedSession.id, 'Chat', selectedSession.project_path, providerId, sessionWithProvider);
        }
      } catch (err) {
        console.error('Failed to load sessions for project:', err);
      }
    };

    window.addEventListener('sidebar-project-selected', handleSidebarProjectSelected as any);
    return () => {
      window.removeEventListener('sidebar-project-selected', handleSidebarProjectSelected as any);
    };
  }, [createChatTab, updateTab, findTabByProjectPath, switchToTab]);

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
