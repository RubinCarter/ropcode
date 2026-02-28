import React, { useState, useCallback, Suspense, lazy } from 'react';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { MobileSettingsPage } from './MobileSettingsPage';
import { ContainerManager } from '@/components/containers';
import { ProjectList } from '@/components/ProjectList';
import { useContainerContext } from '@/contexts/ContainerContext';
import { WorkspaceTabProvider } from '@/contexts/WorkspaceTabContext';
import { api, type Project } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { RightSidebar } from '@/components/right-sidebar';

const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));

export const MobileLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const { switchToWorkspace, activeWorkspaceId, activeType } = useContainerContext();
  const activeProjectPath = activeType === 'workspace' ? activeWorkspaceId : null;

  React.useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
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

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <MobileHeader activeTab={activeTab} />

      <div className="flex-1 overflow-hidden" style={{ paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}>
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
                onCreateWorkspace={() => {}}
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
                <RightSidebar
                  isOpen={true}
                  defaultWidthPercent={100}
                  currentProjectPath={activeProjectPath}
                  className="relative w-full"
                />
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
