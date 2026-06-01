import React, { Suspense, lazy, useEffect } from 'react';
import { useSystemTabContext } from '@/contexts/SystemTabContext';
import { Loader2 } from 'lucide-react';
import { SettingsLoadingShell } from '@/components/SettingsLoadingShell';

const loadSettings = () => import('@/components/Settings').then(m => ({ default: m.Settings }));

const prefetchSettings = () => {
  void loadSettings().catch(() => undefined);
};

const scheduleSettingsPrefetch = () => {
  const win = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof win.requestIdleCallback === 'function') {
    const idleId = win.requestIdleCallback(prefetchSettings, { timeout: 1500 });
    return () => win.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(prefetchSettings, 600);
  return () => globalThis.clearTimeout(timeoutId);
};

// Lazy load components with named exports
const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));
const UsageDashboard = lazy(() => import('@/components/UsageDashboard').then(m => ({ default: m.UsageDashboard })));
const MCPManager = lazy(() => import('@/components/MCPManager').then(m => ({ default: m.MCPManager })));
const Settings = lazy(loadSettings);
const MarkdownEditor = lazy(() => import('@/components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
const CreateAgent = lazy(() => import('@/components/CreateAgent').then(m => ({ default: m.CreateAgent })));

interface SystemContainerProps {
  visible: boolean;
}

export const SystemContainer: React.FC<SystemContainerProps> = ({ visible }) => {
  const { getActiveTab } = useSystemTabContext();
  const activeTab = getActiveTab();

  useEffect(() => {
    return scheduleSettingsPrefetch();
  }, []);

  const fallback = activeTab?.type === 'settings' ? (
    <SettingsLoadingShell />
  ) : (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  const renderContent = () => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <p className="text-lg mb-2">Select an option from the sidebar</p>
            <p className="text-sm">Agents, Usage, Settings, and more</p>
          </div>
        </div>
      );
    }

    switch (activeTab.type) {
      case 'agents':
        return <Agents />;
      case 'usage':
        return <UsageDashboard onBack={() => {}} />;
      case 'mcp':
        return <MCPManager onBack={() => {}} />;
      case 'settings':
        return <Settings onBack={() => {}} />;
      case 'claude-md':
        return <MarkdownEditor onBack={() => {}} />;
      case 'create-agent':
        return <CreateAgent onAgentCreated={() => {}} onBack={() => {}} />;
      case 'import-agent':
        return (
          <div className="flex items-center justify-center h-full">
            <div className="p-4">Import agent functionality coming soon...</div>
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <div className="p-4">Unknown tab type: {activeTab.type}</div>
          </div>
        );
    }
  };

  return (
    <div className={`h-full w-full flex flex-col ${visible ? '' : 'hidden'}`}>
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={fallback}>
          {renderContent()}
        </Suspense>
      </div>
    </div>
  );
};

export default SystemContainer;
