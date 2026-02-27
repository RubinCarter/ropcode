import React from 'react';
import type { MobileTab } from './MobileTabBar';

interface MobileHeaderProps {
  activeTab: MobileTab;
}

const tabTitles: Record<MobileTab, string> = {
  chat: 'Chat',
  projects: 'Projects',
  agents: 'Agents',
  status: 'Status',
  settings: 'Settings',
};

export const MobileHeader: React.FC<MobileHeaderProps> = ({ activeTab }) => {
  return (
    <header className="h-11 bg-background/95 backdrop-blur-sm border-b border-border flex items-center px-4 shrink-0 z-[100]">
      <h1 className="text-sm font-semibold">{tabTitles[activeTab]}</h1>
    </header>
  );
};
