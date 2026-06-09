import React, { useState } from 'react';
import { Settings, BarChart3, FileText, Network, Info, Bug, ChevronRight, ArrowLeft } from 'lucide-react';
import { DebugLogs } from '@/components/DebugLogs';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MCPManager } from '@/components/MCPManager';
import { Settings as SettingsPage } from '@/components/Settings';
import { UsageDashboard } from '@/components/UsageDashboard';

type SettingsSubPage = 'list' | 'settings' | 'usage' | 'memory' | 'mcp' | 'about' | 'debug';

const menuItems: { id: SettingsSubPage; label: string; icon: React.ElementType }[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'usage', label: 'Usage Dashboard', icon: BarChart3 },
  { id: 'memory', label: 'Memory (Claude MD)', icon: FileText },
  { id: 'mcp', label: 'MCP Servers', icon: Network },
  { id: 'debug', label: 'Debug Logs', icon: Bug },
  { id: 'about', label: 'About', icon: Info },
];

export const MobileSettingsPage: React.FC = () => {
  const [subPage, setSubPage] = useState<SettingsSubPage>('list');

  if (subPage !== 'list') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
          <button
            onClick={() => setSubPage('list')}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">
            {menuItems.find(i => i.id === subPage)?.label || 'Settings'}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {subPage === 'settings' && <SettingsPage onBack={() => setSubPage('list')} />}
          {subPage === 'usage' && <UsageDashboard onBack={() => setSubPage('list')} />}
          {subPage === 'memory' && <MarkdownEditor onBack={() => setSubPage('list')} />}
          {subPage === 'mcp' && <MCPManager onBack={() => setSubPage('list')} />}
          {subPage === 'debug' && <div className="p-3"><DebugLogs /></div>}
          {subPage === 'about' && (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground mb-2">Ropcode</p>
              <p>AI-powered coding assistant</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="py-2">
        {menuItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubPage(id)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors"
          >
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-left text-sm">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
};
