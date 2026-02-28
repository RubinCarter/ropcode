import React from 'react';
import { MessageSquare, FolderOpen, Bot, PanelRight, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileTab = 'chat' | 'projects' | 'agents' | 'status' | 'settings';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const tabs: { id: MobileTab; label: string; icon: React.ElementType }[] = [
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'status', label: 'Status', icon: PanelRight },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const MobileTabBar: React.FC<MobileTabBarProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav
      className="shrink-0 z-[100] bg-background/95 backdrop-blur-sm border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors',
              activeTab === id
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};
