import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Bot, AlertCircle, Loader2, BarChart, Server, Settings, FileText, Globe } from 'lucide-react';
import { useTabState } from '@/hooks/useTabState';
import { Tab, useTabContext } from '@/contexts/TabContext';
import { cn } from '@/lib/utils';
import { useTrackEvent } from '@/hooks';

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onClose: (id: string) => void;
  onClick: (id: string) => void;
}

const TabItem: React.FC<TabItemProps> = ({ tab, isActive, onClose, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const getIcon = () => {
    switch (tab.type) {
      case 'chat':
        return MessageSquare;
      case 'agent':
      case 'agents':
        return Bot;
      case 'usage':
        return BarChart;
      case 'mcp':
        return Server;
      case 'settings':
        return Settings;
      case 'claude-md':
      case 'claude-file':
        return FileText;
      case 'webview':
        return Globe;
      case 'agent-execution':
      case 'create-agent':
      case 'import-agent':
        return Bot;
      default:
        return MessageSquare;
    }
  };

  const getStatusIcon = () => {
    switch (tab.status) {
      case 'running':
        return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-3 h-3 text-red-500" />;
      default:
        return null;
    }
  };

  const Icon = getIcon();
  const statusIcon = getStatusIcon();

  return (
    <div
      id={tab.id}
      className={cn(
        "relative flex items-center gap-1.5 text-sm cursor-pointer select-none group",
        "transition-colors duration-100 overflow-hidden border-r border-border/20",
        isActive
          ? "bg-card text-card-foreground"
          : "bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        tab.type === 'chat' ? "min-w-[70px] max-w-[160px]" : "min-w-[90px] max-w-[200px]",
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

      {/* Status Indicators - only show when needed */}
      {(statusIcon || tab.hasUnsavedChanges) && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {statusIcon && (
            <span className="flex items-center justify-center">
              {statusIcon}
            </span>
          )}

          {tab.hasUnsavedChanges && !statusIcon && (
            <span
              className="w-1.5 h-1.5 bg-primary rounded-full"
              title="Unsaved changes"
            />
          )}
        </div>
      )}

      {/* Close Button - Hidden for Chat tabs, always reserves space for others */}
      {tab.type !== 'chat' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className={cn(
            "flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm",
            "transition-all duration-100 hover:bg-destructive/20 hover:text-destructive",
            "focus:outline-none focus:ring-1 focus:ring-destructive/50 ml-0.5",
            (isHovered || isActive) ? "opacity-100" : "opacity-0"
          )}
          title={`Close ${tab.title}`}
          tabIndex={-1}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

    </div>
  );
};

interface TabManagerProps {
  className?: string;
}

export const TabManager: React.FC<TabManagerProps> = ({ className }) => {
  const {
    tabs,
    activeTabId,
    closeTab,
    switchToTab
  } = useTabState();

  // Access workspace info from context
  const { currentWorkspaceId, getTabsByWorkspace } = useTabContext();

  // Filter and sort tabs based on current workspace
  // Order: Chat tabs -> Diff tabs -> Global tabs
  const visibleTabs = useMemo(() => {
    const workspaceTabs = getTabsByWorkspace(currentWorkspaceId);

    return workspaceTabs.sort((a, b) => {
      // Define sort priority: chat (0) -> diff (1) -> global (2)
      const getPriority = (tab: typeof a) => {
        if (tab.type === 'chat') return 0;
        if (tab.type === 'diff') return 1;
        return 2; // Global tabs (agents, usage, settings, etc.)
      };

      const priorityA = getPriority(a);
      const priorityB = getPriority(b);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Within same category, maintain original order
      return a.order - b.order;
    });
  }, [tabs, currentWorkspaceId, getTabsByWorkspace]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  
  // Analytics tracking
  const trackEvent = useTrackEvent();

  // Listen for tab switch events
  useEffect(() => {
    const handleSwitchToTab = (event: CustomEvent) => {
      const { tabId } = event.detail;
      switchToTab(tabId);
    };

    window.addEventListener('switch-to-tab', handleSwitchToTab as EventListener);
    return () => {
      window.removeEventListener('switch-to-tab', handleSwitchToTab as EventListener);
    };
  }, [switchToTab]);

  // Listen for keyboard shortcut events
  useEffect(() => {
    // Removed handleCreateTab - no longer creating tabs via shortcuts

    const handleCloseTab = async () => {
      if (activeTabId) {
        const tab = visibleTabs.find(t => t.id === activeTabId);
        if (tab) {
          trackEvent.tabClosed(tab.type);
        }
        await closeTab(activeTabId);
      }
    };

    const handleNextTab = () => {
      const currentIndex = visibleTabs.findIndex(tab => tab.id === activeTabId);
      const nextIndex = (currentIndex + 1) % visibleTabs.length;
      if (visibleTabs[nextIndex]) {
        switchToTab(visibleTabs[nextIndex].id);
      }
    };

    const handlePreviousTab = () => {
      const currentIndex = visibleTabs.findIndex(tab => tab.id === activeTabId);
      const previousIndex = currentIndex === 0 ? visibleTabs.length - 1 : currentIndex - 1;
      if (visibleTabs[previousIndex]) {
        switchToTab(visibleTabs[previousIndex].id);
      }
    };

    const handleTabByIndex = (event: CustomEvent) => {
      const { index } = event.detail;
      if (visibleTabs[index]) {
        switchToTab(visibleTabs[index].id);
      }
    };

    // Removed 'create-chat-tab' event listener
    window.addEventListener('close-current-tab', handleCloseTab);
    window.addEventListener('switch-to-next-tab', handleNextTab);
    window.addEventListener('switch-to-previous-tab', handlePreviousTab);
    window.addEventListener('switch-to-tab-by-index', handleTabByIndex as EventListener);

    return () => {
      window.removeEventListener('close-current-tab', handleCloseTab);
      window.removeEventListener('switch-to-next-tab', handleNextTab);
      window.removeEventListener('switch-to-previous-tab', handlePreviousTab);
      window.removeEventListener('switch-to-tab-by-index', handleTabByIndex as EventListener);
    };
  }, [visibleTabs, activeTabId, closeTab, switchToTab, trackEvent]);

  // Check scroll buttons visibility
  const checkScrollButtons = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftScroll(scrollLeft > 0);
    setShowRightScroll(scrollLeft + clientWidth < scrollWidth - 1);
  };

  useEffect(() => {
    checkScrollButtons();
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', checkScrollButtons);
    window.addEventListener('resize', checkScrollButtons);

    return () => {
      container.removeEventListener('scroll', checkScrollButtons);
      window.removeEventListener('resize', checkScrollButtons);
    };
  }, [visibleTabs]);

  const handleCloseTab = async (id: string) => {
    const tab = visibleTabs.find(t => t.id === id);
    if (tab) {
      trackEvent.tabClosed(tab.type);
    }
    await closeTab(id);
  };

  // Removed handleNewTab - no longer creating tabs via + button

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
            {visibleTabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClose={handleCloseTab}
                onClick={switchToTab}
              />
            ))}
          </div>

          {/* Removed New tab button - only sidebar can create tabs now */}
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

export default TabManager;