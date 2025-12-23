import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, Bot, AlertCircle, Loader2, FileText, Globe, FileDiff, File } from 'lucide-react';
import { useWorkspaceTabContext, WorkspaceTab } from '@/contexts/WorkspaceTabContext';
import { cn } from '@/lib/utils';

interface TabItemProps {
  tab: WorkspaceTab;
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
      case 'agent-execution':
        return Bot;
      case 'diff':
        return FileDiff;
      case 'file':
      case 'claude-file':
        return File;
      case 'webview':
        return Globe;
      default:
        return FileText;
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
        "relative flex items-center gap-1.5 text-sm cursor-pointer select-none group wails-no-drag",
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

interface WorkspaceTabManagerProps {
  className?: string;
}

export const WorkspaceTabManager: React.FC<WorkspaceTabManagerProps> = ({ className }) => {
  const { tabs, activeTabId, removeTab, setActiveTab } = useWorkspaceTabContext();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Sort tabs: chat first, then diff, then others
  const sortedTabs = [...tabs].sort((a, b) => {
    const getPriority = (tab: WorkspaceTab) => {
      if (tab.type === 'chat') return 0;
      if (tab.type === 'diff') return 1;
      return 2;
    };
    return getPriority(a) - getPriority(b);
  });

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

  // Listen for keyboard shortcuts
  useEffect(() => {
    const handleCloseTab = () => {
      if (activeTabId) {
        const tab = tabs.find(t => t.id === activeTabId);
        // Don't close chat tabs via keyboard
        if (tab && tab.type !== 'chat') {
          removeTab(activeTabId);
        }
      }
    };

    const handleNextTab = () => {
      const currentIndex = sortedTabs.findIndex(tab => tab.id === activeTabId);
      const nextIndex = (currentIndex + 1) % sortedTabs.length;
      if (sortedTabs[nextIndex]) {
        setActiveTab(sortedTabs[nextIndex].id);
      }
    };

    const handlePreviousTab = () => {
      const currentIndex = sortedTabs.findIndex(tab => tab.id === activeTabId);
      const previousIndex = currentIndex === 0 ? sortedTabs.length - 1 : currentIndex - 1;
      if (sortedTabs[previousIndex]) {
        setActiveTab(sortedTabs[previousIndex].id);
      }
    };

    const handleTabByIndex = (event: CustomEvent) => {
      const { index } = event.detail;
      if (sortedTabs[index]) {
        setActiveTab(sortedTabs[index].id);
      }
    };

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
  }, [sortedTabs, activeTabId, removeTab, setActiveTab]);

  const handleCloseTab = (id: string) => {
    removeTab(id);
  };

  const handleTabClick = (id: string) => {
    setActiveTab(id);
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
            {sortedTabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClose={handleCloseTab}
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

export default WorkspaceTabManager;
