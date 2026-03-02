import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { FileEntry } from '@/lib/api';
import {
  ArrowLeft,
  FolderOpen,
  ChevronRight,
  X,
  Home,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIconConfig } from '@/lib/file-icons';

interface ServerDirPickerProps {
  /** Initial directory to show */
  initialPath: string;
  /** Called when a directory is selected */
  onSelect: (path: string) => void;
  /** Called when the picker is dismissed */
  onCancel: () => void;
}

/**
 * Server-side directory picker dialog.
 * Used in Web (non-Electron) mode to browse server directories.
 */
export const ServerDirPicker: React.FC<ServerDirPickerProps> = ({
  initialPath,
  onSelect,
  onCancel,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<string[]>([initialPath]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [pathInput, setPathInput] = useState(initialPath);
  const [pathFocused, setPathFocused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load directory contents (directories only)
  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  // Sync pathInput when currentPath changes (from navigation clicks)
  useEffect(() => {
    if (!pathFocused) {
      setPathInput(currentPath);
    }
  }, [currentPath, pathFocused]);

  // Keyboard navigation (only when path input is NOT focused)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pathFocused) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onCancel();
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < entries.length) {
            navigateToDirectory(entries[selectedIndex].path);
          } else {
            onSelect(currentPath);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(-1, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(entries.length - 1, prev + 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < entries.length) {
            navigateToDirectory(entries[selectedIndex].path);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (pathHistory.length > 1) {
            navigateBack();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entries, selectedIndex, pathFocused, currentPath, pathHistory.length]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    setError(null);
    setSelectedIndex(-1);
    try {
      const contents: FileEntry[] = await api.listDirectoryContents(path);
      // Filter to directories only, sort alphabetically
      const dirs = contents
        .filter((e: any) => e.is_directory)
        .sort((a, b) => a.name.localeCompare(b.name));
      setEntries(dirs);
    } catch (err) {
      console.error('[ServerDirPicker] Failed to load directory:', path, err);
      setError(err instanceof Error ? err.message : 'Failed to load directory');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToDirectory = (path: string) => {
    setCurrentPath(path);
    setPathHistory(prev => [...prev, path]);
  };

  const navigateBack = () => {
    if (pathHistory.length > 1) {
      const newHistory = [...pathHistory];
      newHistory.pop();
      const previousPath = newHistory[newHistory.length - 1];
      setCurrentPath(previousPath);
      setPathHistory(newHistory);
    }
  };

  const handlePathSubmit = () => {
    const trimmed = pathInput.trim();
    if (trimmed && trimmed !== currentPath) {
      setCurrentPath(trimmed);
      setPathHistory(prev => [...prev, trimmed]);
    }
    setPathFocused(false);
    inputRef.current?.blur();
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePathSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPathInput(currentPath);
      setPathFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3 border-b">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Select Directory</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <Button
            variant="ghost"
            size="icon"
            onClick={navigateBack}
            disabled={pathHistory.length <= 1}
            className="h-7 w-7 flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const home = initialPath;
              setCurrentPath(home);
              setPathHistory([home]);
            }}
            className="h-7 w-7 flex-shrink-0"
            title="Go to home"
          >
            <Home className="h-4 w-4" />
          </Button>
          <input
            ref={inputRef}
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onFocus={() => setPathFocused(true)}
            onBlur={handlePathSubmit}
            onKeyDown={handlePathKeyDown}
            className="flex-1 px-2 py-1 text-sm font-mono border rounded bg-background"
          />
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]" ref={listRef}>
          {isLoading && entries.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-32 px-4">
              <span className="text-sm text-destructive text-center">{error}</span>
            </div>
          )}

          {!isLoading && !error && entries.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <span className="text-sm text-muted-foreground">No subdirectories</span>
            </div>
          )}

          {entries.length > 0 && (
            <div className="p-2 space-y-0.5">
              {entries.map((entry, index) => {
                const iconConfig = getFileIconConfig(entry.name, true);
                const IconComponent = iconConfig.icon;
                return (
                  <button
                    key={entry.path}
                    data-index={index}
                    onClick={() => navigateToDirectory(entry.path)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md',
                      'hover:bg-accent transition-colors',
                      'text-left text-sm',
                      index === selectedIndex && 'bg-accent'
                    )}
                  >
                    <IconComponent
                      className="h-4 w-4 flex-shrink-0"
                      style={{ color: iconConfig.color }}
                    />
                    <span className="flex-1 truncate">{entry.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground truncate flex-1" title={currentPath}>
            {currentPath}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onSelect(currentPath)}>
              <FolderOpen className="h-4 w-4 mr-1.5" />
              Select
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
