import React from 'react';
import type { MobileTab } from './MobileTabBar';
import { InstanceSwitcher } from '@/components/InstanceSwitcher';

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
  const port = typeof window !== 'undefined' ? window.location.port : '';

  return (
    <header data-mobile-header className="h-11 bg-background/95 backdrop-blur-sm border-b border-border flex items-center justify-between px-4 shrink-0 z-[100]">
      <h1 className="text-sm font-semibold">{tabTitles[activeTab]}</h1>
      {port && <InstanceSwitcher />}
    </header>
  );
};
