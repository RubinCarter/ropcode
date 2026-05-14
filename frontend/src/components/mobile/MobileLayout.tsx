import React, { useState, useCallback, Suspense, lazy } from 'react';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { MobileSettingsPage } from './MobileSettingsPage';
import { ContainerManager } from '@/components/containers';
import { ProjectList } from '@/components/ProjectList';
import { useContainerContext } from '@/contexts/ContainerContext';
import { WorkspaceTabProvider, useWorkspaceTabContext } from '@/contexts/WorkspaceTabContext';
import { api, type Project } from '@/lib/api';
import { wsClient } from '@/lib/ws-rpc-client';
import { Loader2, ArrowLeft } from 'lucide-react';
import { RightSidebar } from '@/components/right-sidebar';
import { FileViewer } from '@/components/FileViewer';
import { DiffViewer } from '@/components/right-sidebar/DiffViewer';

const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));

/**
 * Wrapper that renders file/diff content when a workspace tab is active,
 * otherwise shows the RightSidebar (Console/Files).
 */
const MobileStatusContent: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const { tabs, activeTabId, removeTab } = useWorkspaceTabContext();

  const activeTab = activeTabId ? tabs.find(t => t.id === activeTabId) : null;
  const showFileContent = activeTab && (activeTab.type === 'file' || activeTab.type === 'diff');

  return (
    <div className="h-full flex flex-col">
      {showFileContent && (
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
            <button
              onClick={() => removeTab(activeTab.id)}
              className="p-1 rounded hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium truncate">{activeTab.title}</span>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab.type === 'file' && activeTab.filePath && (
              <FileViewer filePath={activeTab.filePath} workspacePath={activeTab.projectPath || projectPath} />
            )}
            {activeTab.type === 'diff' && activeTab.filePath && (
              <DiffViewer filePath={activeTab.filePath} workspacePath={activeTab.projectPath || projectPath} gitStatus={activeTab.gitStatus} />
            )}
          </div>
        </div>
      )}
      <div className={showFileContent ? 'hidden' : 'h-full'}>
        <RightSidebar
          isOpen={true}
          defaultWidthPercent={100}
          currentProjectPath={projectPath}
          className="relative w-full"
        />
      </div>
    </div>
  );
};

export const MobileLayout: React.FC = () => {
  const { switchToWorkspace, activeWorkspaceId, activeType } = useContainerContext();
  const activeProjectPath = activeType === 'workspace' ? activeWorkspaceId : null;
  const [activeTab, setActiveTab] = useState<MobileTab>(activeProjectPath ? 'chat' : 'projects');
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadProjects();
    // Also reload when WebSocket reconnects (handles initial connection delay/failure)
    const unsub = wsClient.onConnect(() => {
      loadProjects();
    });
    return unsub;
  }, []);

  const loadProjects = async () => {
    // Wait for WebSocket connection before making RPC calls
    if (!wsClient.isConnected()) {
      try {
        await wsClient.waitForConnection(10000);
      } catch {
        setLoading(false);
        return;
      }
    }

    try {
      setLoading(true);
      const projectList = await api.listProjects();
      setProjects(projectList);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectClick = useCallback((project: Project) => {
    switchToWorkspace(project.path);
    setActiveTab('chat');
  }, [switchToWorkspace]);

  const handleCreateWorkspace = useCallback(async (project: Project) => {
    const { generateWorkspaceName } = await import('@/lib/nameGenerator');
    try {
      const name = generateWorkspaceName();
      await api.createWorkspace(project.path, name, name);
      const projectList = await api.listProjects();
      setProjects(projectList);
      const updatedProject = projectList.find(p => p.path === project.path);
      const newWorkspace = updatedProject?.workspaces?.find(ws => ws.name === name || ws.branch === name);
      const claudeProvider = newWorkspace?.providers?.find(p => p.provider_id === 'claude');
      if (claudeProvider?.path) {
        switchToWorkspace(claudeProvider.path);
        setActiveTab('chat');
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  }, [switchToWorkspace]);

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <MobileHeader activeTab={activeTab} />

      <div className="flex-1 overflow-hidden">
        {/* Chat: ContainerManager always mounted, visibility via CSS */}
        <div className={activeTab === 'chat' ? 'h-full' : 'hidden'}>
          <ContainerManager />
        </div>

        {/* Projects */}
        {activeTab === 'projects' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
              <ProjectList
                projects={projects}
                onProjectClick={handleProjectClick}
                onOpenProject={() => {}}
                onCreateWorkspace={handleCreateWorkspace}
                onRefresh={loadProjects}
                loading={loading}
                activeProjectPath={activeProjectPath}
                className="border-0"
              />
            </div>
          </div>
        )}

        {/* Agents */}
        {activeTab === 'agents' && (
          <div className="h-full overflow-auto">
            <Suspense fallback={
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            }>
              <Agents />
            </Suspense>
          </div>
        )}

        {/* Status (Right Sidebar content full-screen) */}
        {activeTab === 'status' && (
          <div className="h-full">
            {activeProjectPath ? (
              <WorkspaceTabProvider workspaceId={activeProjectPath}>
                <MobileStatusContent projectPath={activeProjectPath} />
              </WorkspaceTabProvider>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p className="text-sm">Select a project first</p>
              </div>
            )}
          </div>
        )}

        {/* Settings */}
        {activeTab === 'settings' && (
          <div className="h-full">
            <MobileSettingsPage />
          </div>
        )}
      </div>

      <MobileTabBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
};
