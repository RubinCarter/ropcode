import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bot, BarChart, Server, Settings, FileText, Plus, Import } from 'lucide-react';
import { useSystemTabContext, SystemTab, SystemTabType } from '@/contexts/SystemTabContext';
import { cn } from '@/lib/utils';

interface TabItemProps {
  tab: SystemTab;
  isActive: boolean;
  onClick: (id: string) => void;
}

const TabItem: React.FC<TabItemProps> = ({ tab, isActive, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = () => {
    switch (tab.type) {
      case 'agents':
        return Bot;
      case 'usage':
        return BarChart;
      case 'mcp':
        return Server;
      case 'settings':
        return Settings;
      case 'claude-md':
        return FileText;
      case 'create-agent':
        return Plus;
      case 'import-agent':
        return Import;
      default:
        return Settings;
    }
  };

  const Icon = getIcon();

  return (
    <div
      id={tab.id}
      className={cn(
        "relative flex items-center gap-1.5 text-sm cursor-pointer select-none group",
        "transition-colors duration-100 overflow-hidden border-r border-border/20",
        isActive
          ? "bg-card text-card-foreground"
          : "bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        "min-w-[90px] max-w-[200px]",
        "h-full px-2 pr-2"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick(tab.id)}
    >
      {/* Tab Icon */}
      <div className="flex-shrink-0">
        <Icon className="w-4 h-4" />
      </div>

      {/* Tab Title */}
      <span className="truncate text-xs font-medium">
        {tab.title}
      </span>
    </div>
  );
};

interface SystemTabManagerProps {
  className?: string;
}

export const SystemTabManager: React.FC<SystemTabManagerProps> = ({ className }) => {
  const { tabs, activeTabId, activateTab } = useSystemTabContext();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Check scroll buttons visibility - use useCallback to stabilize
  const checkScrollButtons = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const shouldShowLeft = scrollLeft > 0;
    const shouldShowRight = scrollLeft + clientWidth < scrollWidth - 1;

    // Only update state if values actually changed
    setShowLeftScroll(prev => prev !== shouldShowLeft ? shouldShowLeft : prev);
    setShowRightScroll(prev => prev !== shouldShowRight ? shouldShowRight : prev);
  }, []);

  // Set up scroll event listeners
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Check after a small delay to ensure DOM is ready
    const timeoutId = setTimeout(checkScrollButtons, 0);

    container.addEventListener('scroll', checkScrollButtons);
    window.addEventListener('resize', checkScrollButtons);

    return () => {
      clearTimeout(timeoutId);
      container.removeEventListener('scroll', checkScrollButtons);
      window.removeEventListener('resize', checkScrollButtons);
    };
  }, [checkScrollButtons]);

  // Re-check when tabs change
  useEffect(() => {
    checkScrollButtons();
  }, [tabs.length, checkScrollButtons]);

  const handleTabClick = (tabId: string) => {
    // Find the tab and activate by type
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      activateTab(tab.type);
    }
  };

  const scrollTabs = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = 200;
    const newScrollLeft = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    });
  };

  // If no tabs, show nothing
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-stretch relative", className)}>
      {/* Left fade gradient */}
      {showLeftScroll && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-transparent pointer-events-none z-10" />
      )}

      {/* Left scroll button */}
      <AnimatePresence>
        {showLeftScroll && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => scrollTabs('left')}
            className={cn(
              "p-1.5 hover:bg-muted/80 rounded-sm z-20 ml-1",
              "transition-colors duration-200 flex items-center justify-center",
              "bg-background/80 backdrop-blur-sm shadow-sm border border-border/50"
            )}
            title="Scroll tabs left"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M15 18l-6-6 6-6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Tabs container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex items-stretch h-full">
          <div className="flex items-stretch">
            {tabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClick={handleTabClick}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right fade gradient */}
      {showRightScroll && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-muted/15 to-transparent pointer-events-none z-10" />
      )}

      {/* Right scroll button */}
      <AnimatePresence>
        {showRightScroll && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => scrollTabs('right')}
            className={cn(
              "p-1.5 hover:bg-muted/80 rounded-sm z-20 mr-1",
              "transition-colors duration-200 flex items-center justify-center",
              "bg-background/80 backdrop-blur-sm shadow-sm border border-border/50"
            )}
            title="Scroll tabs right"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 18l6-6-6-6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SystemTabManager;
