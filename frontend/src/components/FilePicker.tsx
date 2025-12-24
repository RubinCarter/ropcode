import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  X,
  ArrowLeft,
  Search,
  ChevronRight,
  Bot
} from "lucide-react";
import type { FileEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/widgets/files/FilesModel";
import { getFileIconConfig } from "@/lib/file-icons";

// Global caches that persist across component instances
const globalDirectoryCache = new Map<string, FileEntry[]>();
const globalSearchCache = new Map<string, FileEntry[]>();

// Note: These caches persist for the lifetime of the application.
// In a production app, you might want to:
// 1. Add TTL (time-to-live) to expire old entries
// 2. Implement LRU (least recently used) eviction
// 3. Clear caches when the working directory changes
// 4. Add a maximum cache size limit

interface FilePickerProps {
  /**
   * The base directory path to browse
   */
  basePath: string;
  /**
   * Callback when a file/directory is selected
   */
  onSelect: (entry: FileEntry) => void;
  /**
   * Callback to close the picker
   */
  onClose: () => void;
  /**
   * Initial search query
   */
  initialQuery?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Whether to show Claude CLI agents alongside files
   */
  showAgents?: boolean;
  /**
   * Optional anchor element ref for positioning the picker
   * If provided, the picker will be rendered via portal and positioned relative to the anchor
   */
  anchorRef?: React.RefObject<HTMLElement>;
}

// Get file icon with color using the centralized icon system
const getFileIcon = (entry: FileEntry) => {
  // Handle agents first
  if (entry.entry_type === "agent") {
    return { icon: Bot, color: '#61dafb' };
  }

  return getFileIconConfig(entry.name, entry.is_directory);
};

// Format file size to human readable
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * FilePicker component - File browser with fuzzy search
 * 
 * @example
 * <FilePicker
 *   basePath="/Users/example/project"
 *   onSelect={(entry) => console.log('Selected:', entry)}
 *   onClose={() => setShowPicker(false)}
 * />
 */
export const FilePicker: React.FC<FilePickerProps> = ({
  basePath,
  onSelect,
  onClose,
  initialQuery = "",
  className,
  showAgents = false,
  anchorRef,
}) => {
  // Local state for selected index
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Track if we're in directory browsing mode (entered a subdirectory)
  // When browsing, we ignore the search query and show directory contents
  const [isBrowsing, setIsBrowsing] = useState(false);

  // Use initialQuery for search, but ignore it when browsing directories
  const searchQuery = isBrowsing ? "" : initialQuery;

  // Use store for loading state only
  const isLoading = useFilesStore((state) => state.isLoading);
  const setLoading = useFilesStore((state) => state.setLoading);

  // Local state for FilePicker-specific data (not in store)
  const [currentPath, setCurrentPath] = useState(basePath);
  const [entries, setEntries] = useState<FileEntry[]>(() =>
    initialQuery.trim() ? [] : globalDirectoryCache.get(basePath) || []
  );
  const [searchResults, setSearchResults] = useState<FileEntry[]>(() => {
    if (initialQuery.trim()) {
      const cacheKey = `${basePath}:${initialQuery}`;
      return globalSearchCache.get(cacheKey) || [];
    }
    return [];
  });
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([basePath]);
  const [isShowingCached, setIsShowingCached] = useState(() => {
    // Check if we're showing cached data on mount
    if (initialQuery.trim()) {
      const cacheKey = `${basePath || 'agents'}:${initialQuery}`;
      return globalSearchCache.has(cacheKey);
    }
    return globalDirectoryCache.has(basePath);
  });

  // Calculate position based on anchor element - use useLayoutEffect to avoid flicker
  useLayoutEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      // Position above the anchor element
      setPosition({
        top: rect.top - 410, // 400px height + 10px margin
        left: rect.left,
      });
    }
  }, [anchorRef]);

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Computed values
  const displayEntries = searchQuery.trim() ? searchResults : entries;
  const canGoBack = pathHistory.length > 1;

  // Get relative path for display
  const relativePath = basePath && currentPath.startsWith(basePath)
    ? currentPath.slice(basePath.length) || '/'
    : currentPath;

  // Load directory contents
  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (searchQuery.trim()) {
      const cacheKey = `${basePath}:${searchQuery}`;

      // Immediately show cached results if available
      if (globalSearchCache.has(cacheKey)) {
        console.log('[FilePicker] Immediately showing cached search results for:', searchQuery);
        setSearchResults(globalSearchCache.get(cacheKey) || []);
        setIsShowingCached(true);
        setError(null);
      }

      // Schedule fresh search after debounce
      searchDebounceRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 300);
    } else {
      setSearchResults([]);
      setIsShowingCached(false);
    }

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, basePath]);

  // Reset selected index when entries change
  useEffect(() => {
    setSelectedIndex(0);
  }, [entries, searchResults]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentDisplayEntries = searchQuery.trim() ? searchResults : entries;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'Enter':
          e.preventDefault();
          // Enter always selects the current item (file or directory)
          if (currentDisplayEntries.length > 0 && selectedIndex < currentDisplayEntries.length) {
            onSelect(currentDisplayEntries[selectedIndex]);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(currentDisplayEntries.length - 1, prev + 1));
          break;

        case 'ArrowRight':
          e.preventDefault();
          // Right arrow enters directories
          if (currentDisplayEntries.length > 0 && selectedIndex < currentDisplayEntries.length) {
            const entry = currentDisplayEntries[selectedIndex];
            if (entry.is_directory) {
              navigateToDirectory(entry.path);
            }
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          // Left arrow goes back to parent directory
          if (canGoBack) {
            navigateBack();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entries, searchResults, selectedIndex, searchQuery, canGoBack, onClose, onSelect]);

  // Scroll selected item into view
  useEffect(() => {
    if (fileListRef.current) {
      const selectedElement = fileListRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const loadDirectory = async (path: string) => {
    try {
      console.log('[FilePicker] Loading directory:', path);

      // Check cache first and show immediately
      if (globalDirectoryCache.has(path)) {
        console.log('[FilePicker] Showing cached contents for:', path);
        setEntries(globalDirectoryCache.get(path) || []);
        setIsShowingCached(true);
        setError(null);
      } else {
        // Only show loading if we don't have cached data
        setLoading(true);
      }

      // Fetch contents from different sources
      const promises: Promise<FileEntry[]>[] = [];

      // Always fetch directory contents if path is provided
      if (path) {
        promises.push(api.listDirectoryContents(path));
      }

      // Add agents if we're showing them and at base path (root level browsing)
      if (showAgents && path === basePath) {
        promises.push(api.listClaudeAgents());
      }

      // Wait for all content loading to complete
      const resultsArrays = await Promise.all(promises);

      // Combine all results
      // Filter out null/undefined entries
      const contents = resultsArrays.flat().filter((entry): entry is FileEntry => entry != null);

      console.log('[FilePicker] Loaded fresh contents:', contents.length, 'items');

      // Sort entries: agents first, then directories, then files
      const sortedContents = [...contents].sort((a, b) => {
        // Agents come first
        if (a?.entry_type === "agent" && b?.entry_type !== "agent") return -1;
        if (a?.entry_type !== "agent" && b?.entry_type === "agent") return 1;

        // Then directories vs files
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;

        // Alphabetical within each group
        return a.name.localeCompare(b.name);
      });

      // Cache the results
      globalDirectoryCache.set(path, sortedContents);

      // Update with fresh data
      setEntries(sortedContents);
      setIsShowingCached(false);
      setError(null);
    } catch (err) {
      console.error('[FilePicker] Failed to load directory:', path, err);
      console.error('[FilePicker] Error details:', err);
      // Only set error if we don't have cached data to show
      if (!globalDirectoryCache.has(path)) {
        setError(err instanceof Error ? err.message : 'Failed to load directory');
      }
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (query: string) => {
    try {
      console.log('[FilePicker] Searching for:', query, 'in:', basePath);

      // Create cache key that includes both query and basePath
      const cacheKey = `${basePath}:${query}`;

      // Check cache first and show immediately
      if (globalSearchCache.has(cacheKey)) {
        console.log('[FilePicker] Showing cached search results for:', query);
        setSearchResults(globalSearchCache.get(cacheKey) || []);
        setIsShowingCached(true);
        setError(null);
      } else {
        // Only show loading if we don't have cached data
        setLoading(true);
      }

      // Fetch results from different sources in parallel
      const promises: Promise<FileEntry[]>[] = [];

      // Add file search if basePath is provided
      if (basePath) {
        promises.push(api.searchFiles(basePath, query));
      }

      // Add agent search if enabled
      if (showAgents) {
        promises.push(api.searchClaudeAgents(query));
      }

      // Wait for all searches to complete
      const resultsArrays = await Promise.all(promises);

      // Combine all results and filter out null/undefined entries
      const results = resultsArrays.flat().filter((entry): entry is FileEntry => entry != null);

      // Sort search results: agents first, then directories, then files
      const sortedResults = [...results].sort((a, b) => {
        // Agents come first
        if (a?.entry_type === "agent" && b?.entry_type !== "agent") return -1;
        if (a?.entry_type !== "agent" && b?.entry_type === "agent") return 1;

        // Then directories vs files
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;

        // Alphabetical within each group
        return a.name.localeCompare(b.name);
      });

      console.log('[FilePicker] Fresh search results:', results.length, 'items');

      // Cache the results
      globalSearchCache.set(cacheKey, sortedResults);

      // Update with fresh results
      setSearchResults(sortedResults);
      setIsShowingCached(false);
      setError(null);
    } catch (err) {
      console.error('[FilePicker] Search failed:', query, err);
      // Only set error if we don't have cached data to show
      const cacheKey = `${basePath}:${query}`;
      if (!globalSearchCache.has(cacheKey)) {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const navigateToDirectory = (path: string) => {
    setCurrentPath(path);
    setPathHistory(prev => [...prev, path]);
    setIsBrowsing(true); // Switch to browsing mode, ignore search query
  };

  const navigateBack = () => {
    if (pathHistory.length > 1) {
      const newHistory = [...pathHistory];
      newHistory.pop(); // Remove current
      const previousPath = newHistory[newHistory.length - 1];

      // Don't go beyond the base path
      if (!basePath || previousPath.startsWith(basePath) || previousPath === basePath) {
        setCurrentPath(previousPath);
        setPathHistory(newHistory);
        // If back to base path, exit browsing mode to restore search
        if (previousPath === basePath) {
          setIsBrowsing(false);
        }
      }
    }
  };

  const handleEntryClick = (entry: FileEntry) => {
    // Single click always selects (file or directory)
    onSelect(entry);
  };
  
  const handleEntryDoubleClick = (entry: FileEntry) => {
    // Double click navigates into directories (but not agents)
    if (entry.is_directory && entry.entry_type !== "agent") {
      navigateToDirectory(entry.path);
    }
  };

  // Determine if we should use portal (when anchorRef is provided)
  const usePortal = !!anchorRef && !!position;

  const pickerContent = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        usePortal ? "fixed z-[9999]" : "absolute bottom-full mb-2 left-0 z-50",
        "w-[500px] h-[400px]",
        "bg-background border border-border rounded-lg shadow-lg",
        "flex flex-col overflow-hidden",
        "will-change-transform transform-gpu",
        className
      )}
      style={usePortal && position ? { top: position.top, left: position.left } : undefined}
    >
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={navigateBack}
              disabled={!canGoBack}
              className="h-8 w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-mono text-muted-foreground truncate max-w-[300px]">
              {relativePath}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Show loading only if no cached data */}
        {isLoading && displayEntries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        )}

        {/* Show subtle indicator when displaying cached data while fetching fresh */}
        {isShowingCached && isLoading && displayEntries.length > 0 && (
          <div className="absolute top-1 right-2 text-xs text-muted-foreground/50 italic">
            updating...
          </div>
        )}

        {error && displayEntries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-destructive">{error}</span>
          </div>
        )}

        {!isLoading && !error && displayEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full">
            <Search className="h-8 w-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">
              {searchQuery.trim() ? 'No files found' : 'Empty directory'}
            </span>
          </div>
        )}

        {displayEntries.length > 0 && (
          <div className="p-2 space-y-0.5" ref={fileListRef}>
            {displayEntries.map((entry, index) => {
              const iconConfig = getFileIcon(entry);
              const IconComponent = iconConfig.icon;
              const isSearching = searchQuery.trim() !== '';
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={entry.path}
                  data-index={index}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                    "hover:bg-accent transition-colors",
                    "text-left text-sm",
                    isSelected && "bg-accent"
                  )}
                  title={entry.is_directory ? "Click to select • Double-click to enter" : "Click to select"}
                >
                  <IconComponent
                    className="h-4 w-4 flex-shrink-0"
                    style={{ color: iconConfig.color }}
                  />

                  <div className="flex-1 flex items-center gap-2 truncate">
                    <span className="truncate">
                      {entry.name}
                    </span>
                    {entry.entry_type === "agent" && entry.icon && (
                      <span className="text-sm">{entry.icon}</span>
                    )}
                  </div>

                  {!entry.is_directory && entry.size > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(entry.size)}
                    </span>
                  )}

                  {entry.is_directory && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}

                  {isSearching && (
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[150px]">
                      {entry.path.replace(basePath, '').replace(/^\//, '')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <p className="text-xs text-muted-foreground text-center">
          ↑↓ Navigate • Enter Select • → Enter Directory • ← Go Back • Esc Close
        </p>
      </div>
    </motion.div>
  );

  // Use portal when anchorRef is provided to escape overflow:hidden containers
  if (usePortal) {
    return createPortal(pickerContent, document.body);
  }

  return pickerContent;
}; 