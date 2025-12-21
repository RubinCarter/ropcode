import React, { Suspense, lazy, useEffect } from 'react';
import { WorkspaceTabProvider, useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import { RightSidebar } from '@/components/right-sidebar';
import { Loader2 } from 'lucide-react';
import { providers } from '@/lib/providers';

// Lazy load heavy components
const AiCodeSession = lazy(() => import('@/components/ai-code-session').then(m => ({ default: m.AiCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer').then(m => ({ default: m.AgentRunOutputViewer })));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const DiffViewer = lazy(() => import('@/components/right-sidebar/DiffViewer').then(m => ({ default: m.DiffViewer })));
const FileViewer = lazy(() => import('@/components/FileViewer').then(m => ({ default: m.FileViewer })));
const WebViewer = lazy(() => import('@/components/WebViewer').then(m => ({ default: m.WebViewer })));

interface WorkspaceContainerProps {
  workspaceId: string;
  visible: boolean;
}

const WorkspaceContent: React.FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const { tabs, activeTabId, addTab, updateTab, removeTab, getTabById } = useWorkspaceTabContext();
  const activeTab = activeTabId ? getTabById(activeTabId) : undefined;

  useEffect(() => {
    if (tabs.length === 0) {
      initializeWorkspace();
    }
  }, []);

  const initializeWorkspace = async () => {
    try {
      const sessionList = await providers.listSessions(workspaceId, 'claude');
      let selectedSession: any = null;
      if (sessionList.length > 0) {
        const sortedSessions = [...sessionList].sort((a, b) => {
          const timeA = a.message_timestamp ? new Date(a.message_timestamp).getTime() : a.created_at * 1000;
          const timeB = b.message_timestamp ? new Date(b.message_timestamp).getTime() : b.created_at * 1000;
          return timeB - timeA;
        });
        selectedSession = sortedSessions[0];
      }
      addTab({
        type: 'chat',
        title: 'Chat',
        sessionId: selectedSession?.id,
        sessionData: selectedSession ? { ...selectedSession, provider: 'claude' } : undefined,
        projectPath: workspaceId,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
    } catch (err) {
      console.error('[WorkspaceContainer] Failed to initialize workspace:', err);
      addTab({
        type: 'chat',
        title: 'Chat',
        projectPath: workspaceId,
        providerId: 'claude',
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'message-square',
      });
    }
  };

  const renderTabContent = () => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>No active tab</p>
        </div>
      );
    }

    switch (activeTab.type) {
      case 'chat':
        return (
          <AiCodeSession
            session={activeTab.sessionData}
            initialProjectPath={activeTab.projectPath}
            defaultProvider={activeTab.providerId}
            onBack={() => {
              // Chat tab doesn't have a back button, this is a no-op
            }}
            onStreamingChange={(isStreaming, sessionId) => {
              if (activeTab.id) {
                updateTab(activeTab.id, {
                  status: isStreaming ? 'running' : 'idle',
                  sessionId: sessionId || activeTab.sessionId,
                });
              }
            }}
            onProjectPathChange={(path) => {
              if (activeTab.id) {
                updateTab(activeTab.id, { projectPath: path });
              }
            }}
            onProviderChange={(providerId) => {
              if (activeTab.id) {
                updateTab(activeTab.id, { providerId });
              }
            }}
          />
        );

      case 'agent':
        if (!activeTab.agentRunId || !activeTab.id) {
          return <div className="flex items-center justify-center h-full">Invalid agent tab</div>;
        }
        return (
          <AgentRunOutputViewer
            agentRunId={activeTab.agentRunId}
            tabId={activeTab.id}
          />
        );

      case 'agent-execution':
        if (!activeTab.agentData) {
          return <div className="flex items-center justify-center h-full">Invalid agent execution tab</div>;
        }
        return (
          <AgentExecution
            agent={activeTab.agentData}
            projectPath={activeTab.projectPath}
            tabId={activeTab.id}
            onBack={() => {
              if (activeTab.id) {
                removeTab(activeTab.id);
              }
            }}
          />
        );

      case 'diff':
        if (!activeTab.filePath || !activeTab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid diff tab</div>;
        }
        return (
          <DiffViewer
            filePath={activeTab.filePath}
            workspacePath={activeTab.projectPath}
          />
        );

      case 'file':
        if (!activeTab.filePath || !activeTab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid file tab</div>;
        }
        return (
          <FileViewer
            filePath={activeTab.filePath}
            workspacePath={activeTab.projectPath}
          />
        );

      case 'webview':
        if (!activeTab.url || !activeTab.projectPath) {
          return <div className="flex items-center justify-center h-full">Invalid webview tab</div>;
        }
        return (
          <WebViewer
            url={activeTab.url}
            workspacePath={activeTab.projectPath}
            onUrlChange={(newUrl) => {
              if (activeTab.id) {
                updateTab(activeTab.id, { url: newUrl });
              }
            }}
          />
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Unsupported tab type: {activeTab.type}</p>
          </div>
        );
    }
  };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      }
    >
      {renderTabContent()}
    </Suspense>
  );
};

export const WorkspaceContainer: React.FC<WorkspaceContainerProps> = ({ workspaceId, visible }) => {
  const [rightSidebarOpen, setRightSidebarOpen] = React.useState(true);

  return (
    <WorkspaceTabProvider workspaceId={workspaceId}>
      <div className={`h-full w-full flex ${visible ? '' : 'hidden'}`}>
        <div className="flex-1 flex flex-col overflow-hidden">
          <WorkspaceContent workspaceId={workspaceId} />
        </div>
        <RightSidebar
          isOpen={rightSidebarOpen}
          onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
          currentProjectPath={workspaceId}
        />
      </div>
    </WorkspaceTabProvider>
  );
};

export default WorkspaceContainer;
