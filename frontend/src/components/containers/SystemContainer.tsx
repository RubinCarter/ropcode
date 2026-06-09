import React from 'react';
import { useSystemTabContext } from '@/contexts/SystemTabContext';
import { Agents } from '@/components/Agents';
import { CreateAgent } from '@/components/CreateAgent';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MCPManager } from '@/components/MCPManager';
import { Settings } from '@/components/Settings';
import { UsageDashboard } from '@/components/UsageDashboard';

interface SystemContainerProps {
  visible: boolean;
}

export const SystemContainer: React.FC<SystemContainerProps> = ({ visible }) => {
  const { getActiveTab } = useSystemTabContext();
  const activeTab = getActiveTab();

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
        {renderContent()}
      </div>
    </div>
  );
};

export default SystemContainer;
