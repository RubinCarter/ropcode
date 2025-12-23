import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { 
  X, 
  Command,
  Globe,
  FolderOpen,
  Zap,
  FileCode,
  Terminal,
  AlertCircle,
  User,
  Building2
} from "lucide-react";
import type { SlashCommand } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTrackEvent, useFeatureAdoptionTracking } from "@/hooks";

interface SlashCommandPickerProps {
  /**
   * The project path for loading project-specific commands
   */
  projectPath?: string;
  /**
   * Callback when a command is selected
   */
  onSelect: (command: SlashCommand) => void;
  /**
   * Callback to close the picker
   */
  onClose: () => void;
  /**
   * Initial search query (text after /)
   */
  initialQuery?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Optional provider filter (claude, codex, or gemini)
   * If specified, only show commands for that provider
   */
  provider?: 'claude' | 'codex' | 'gemini';
  /**
   * Optional anchor element ref for positioning the picker
   * If provided, the picker will be rendered via portal and positioned relative to the anchor
   */
  anchorRef?: React.RefObject<HTMLElement>;
}

// Get icon for command based on its properties
const getCommandIcon = (command: SlashCommand) => {
  // If it has bash commands, show terminal icon
  if (command.has_bash_commands) return Terminal;
  
  // If it has file references, show file icon
  if (command.has_file_references) return FileCode;
  
  // If it accepts arguments, show zap icon
  if (command.accepts_arguments) return Zap;
  
  // Based on scope
  if (command.scope === "project") return FolderOpen;
  if (command.scope === "user") return Globe;
  
  // Default
  return Command;
};

/**
 * SlashCommandPicker component - Autocomplete UI for slash commands
 * 
 * @example
 * <SlashCommandPicker
 *   projectPath="/Users/example/project"
 *   onSelect={(command) => console.log('Selected:', command)}
 *   onClose={() => setShowPicker(false)}
 * />
 */
export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
  projectPath,
  onSelect,
  onClose,
  initialQuery = "",
  className,
  provider,
  anchorRef,
}) => {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const commandListRef = useRef<HTMLDivElement>(null);

  // Calculate position based on anchor element
  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      // Position above the anchor element
      setPosition({
        top: rect.top - 410, // 400px height + 10px margin
        left: rect.left,
      });
    }
  }, [anchorRef]);
  
  // Analytics tracking
  const trackEvent = useTrackEvent();
  const slashCommandFeatureTracking = useFeatureAdoptionTracking('slash_commands');
  
  // Load commands on mount or when project path changes
  useEffect(() => {
    loadCommands();
  }, [projectPath]);
  
  // Filter commands based on search query and provider
  useEffect(() => {
    if (!commands.length) {
      setFilteredCommands([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    let filtered: SlashCommand[];

    // First filter by provider if specified
    if (provider) {
      filtered = commands.filter(cmd => cmd.command_type === provider);
    } else {
      filtered = commands;
    }

    // Then filter by search query
    if (query) {
      filtered = filtered.filter(cmd => {
        // Match against command name
        if (cmd.name.toLowerCase().includes(query)) return true;

        // Match against full command
        if (cmd.full_command.toLowerCase().includes(query)) return true;

        // Match against namespace
        if (cmd.namespace && cmd.namespace.toLowerCase().includes(query)) return true;

        // Match against description
        if (cmd.description && cmd.description.toLowerCase().includes(query)) return true;

        return false;
      });

      // Sort by relevance
      filtered.sort((a, b) => {
        // Exact name match first
        const aExact = a.name.toLowerCase() === query;
        const bExact = b.name.toLowerCase() === query;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Then by name starts with
        const aStarts = a.name.toLowerCase().startsWith(query);
        const bStarts = b.name.toLowerCase().startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Then alphabetically
        return a.name.localeCompare(b.name);
      });
    }

    setFilteredCommands(filtered);

    // Reset selected index when filtered list changes
    setSelectedIndex(0);
  }, [searchQuery, commands, provider]);

  // Group commands by scope and namespace - computed before keyboard navigation
  const { groupedCommands, sortedGroupKeys, orderedCommands } = useMemo(() => {
    const grouped = filteredCommands.reduce((acc, cmd) => {
      let key: string;
      if (cmd.scope === "default") {
        key = cmd.namespace ? `Built-in Commands: ${cmd.namespace}` : "Built-in Commands";
      } else if (cmd.scope === "user") {
        key = cmd.namespace ? `User Commands: ${cmd.namespace}` : "User Commands";
      } else if (cmd.scope === "project") {
        key = cmd.namespace ? `Project Commands: ${cmd.namespace}` : "Project Commands";
      } else {
        key = cmd.namespace || "Commands";
      }

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(cmd);
      return acc;
    }, {} as Record<string, SlashCommand[]>);

    // Sort group keys: Commands (plugins) first, then Built-in, User, Project
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const order = (key: string) => {
        if (key === "Commands" || (!key.startsWith("Built-in") && !key.startsWith("User") && !key.startsWith("Project"))) return 0;
        if (key.startsWith("Built-in")) return 1;
        if (key.startsWith("User")) return 2;
        if (key.startsWith("Project")) return 3;
        return 4;
      };
      return order(a) - order(b);
    });

    // Create flat list in render order for keyboard navigation
    const ordered = sortedKeys.flatMap(key => grouped[key]);

    return { groupedCommands: grouped, sortedGroupKeys: sortedKeys, orderedCommands: ordered };
  }, [filteredCommands]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
          
        case 'Enter':
          e.preventDefault();
          if (orderedCommands.length > 0 && selectedIndex < orderedCommands.length) {
            const command = orderedCommands[selectedIndex];
            trackEvent.slashCommandSelected({
              command_name: command.name,
              selection_method: 'keyboard'
            });
            slashCommandFeatureTracking.trackUsage();
            onSelect(command);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(orderedCommands.length - 1, prev + 1));
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orderedCommands, selectedIndex, onSelect, onClose]);
  
  // Scroll selected item into view
  useEffect(() => {
    if (commandListRef.current) {
      const selectedElement = commandListRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);
  
  const loadCommands = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Always load fresh commands from filesystem
      const loadedCommands = await api.slashCommandsList(projectPath);
      setCommands(loadedCommands);
    } catch (err) {
      console.error("Failed to load slash commands:", err);
      setError(err instanceof Error ? err.message : 'Failed to load commands');
      setCommands([]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleCommandClick = (command: SlashCommand) => {
    trackEvent.slashCommandSelected({
      command_name: command.name,
      selection_method: 'click'
    });
    slashCommandFeatureTracking.trackUsage();
    onSelect(command);
  };

  // Update search query from parent
  useEffect(() => {
    setSearchQuery(initialQuery);
  }, [initialQuery]);

  // Determine if we should use portal (when anchorRef is provided)
  const usePortal = !!anchorRef && !!position;

  const pickerContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        usePortal ? "fixed z-[9999]" : "absolute bottom-full mb-2 left-0 z-50",
        "w-[600px] h-[400px]",
        "bg-background border border-border rounded-lg shadow-lg",
        "flex flex-col overflow-hidden",
        className
      )}
      style={usePortal && position ? { top: position.top, left: position.left } : undefined}
    >
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Command className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Slash Commands</span>
            {searchQuery && (
              <span className="text-xs text-muted-foreground">
                Searching: "{searchQuery}"
              </span>
            )}
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

      {/* Command List */}
      <div className="flex-1 overflow-y-auto relative">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-muted-foreground">Loading commands...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full p-4">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <span className="text-sm text-destructive text-center">{error}</span>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {filteredCommands.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full">
                <Command className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? 'No commands found' : 'No commands available'}
                </span>
                {!searchQuery && (
                  <p className="text-xs text-muted-foreground mt-2 text-center px-4">
                    {provider === 'codex' ? (
                      <>Create commands in <code className="px-1">.codex/prompts/</code> or <code className="px-1">~/.codex/prompts/</code></>
                    ) : provider === 'claude' ? (
                      <>Create commands in <code className="px-1">.claude/commands/</code> or <code className="px-1">~/.claude/commands/</code></>
                    ) : (
                      <>Create commands in <code className="px-1">.claude/commands/</code>, <code className="px-1">~/.claude/commands/</code>, <code className="px-1">.codex/prompts/</code>, or <code className="px-1">~/.codex/prompts/</code></>
                    )}
                  </p>
                )}
              </div>
            )}

            {orderedCommands.length > 0 && (
              <div className="p-2" ref={commandListRef}>
                {/* If no grouping needed, show flat list */}
                {sortedGroupKeys.length === 1 ? (
                  <div className="space-y-0.5">
                    {orderedCommands.map((command, index) => {
                      const Icon = getCommandIcon(command);
                      const isSelected = index === selectedIndex;
                      
                      return (
                        <button
                          key={command.id}
                          data-index={index}
                          onClick={() => handleCommandClick(command)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            "w-full flex items-start gap-3 px-3 py-2 rounded-md",
                            "hover:bg-accent transition-colors",
                            "text-left",
                            isSelected && "bg-accent"
                          )}
                        >
                          <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-sm text-primary">
                                {command.full_command}
                              </span>
                              {command.accepts_arguments && (
                                <span className="text-xs text-muted-foreground">
                                  [args]
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                {command.scope}
                              </span>
                            </div>

                            {command.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {command.description}
                              </p>
                            )}

                            {/* Show argument hint for Codex commands */}
                            {command.command_type === 'codex' && command.argument_hint && (
                              <p className="text-xs font-mono text-blue-600 dark:text-blue-400 mt-0.5 truncate">
                                {command.argument_hint}
                              </p>
                            )}

                            <div className="flex items-center gap-3 mt-1">
                              {command.allowed_tools && command.allowed_tools.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {command.allowed_tools.length} tool{command.allowed_tools.length === 1 ? '' : 's'}
                                </span>
                              )}
                              
                              {command.has_bash_commands && (
                                <span className="text-xs text-blue-600 dark:text-blue-400">
                                  Bash
                                </span>
                              )}
                              
                              {command.has_file_references && (
                                <span className="text-xs text-green-600 dark:text-green-400">
                                  Files
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  // Show grouped by scope/namespace
                  <div className="space-y-4">
                    {sortedGroupKeys.map((groupKey) => (
                      <div key={groupKey}>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1 flex items-center gap-2">
                          {groupKey.startsWith("Built-in Commands") && <Command className="h-3 w-3" />}
                          {groupKey.startsWith("User Commands") && <User className="h-3 w-3" />}
                          {groupKey.startsWith("Project Commands") && <Building2 className="h-3 w-3" />}
                          {groupKey}
                        </h3>

                        <div className="space-y-0.5">
                          {groupedCommands[groupKey].map((command) => {
                            const Icon = getCommandIcon(command);
                            const globalIndex = orderedCommands.indexOf(command);
                            const isSelected = globalIndex === selectedIndex;
                            
                            return (
                              <button
                                key={command.id}
                                data-index={globalIndex}
                                onClick={() => handleCommandClick(command)}
                                onMouseEnter={() => setSelectedIndex(globalIndex)}
                                className={cn(
                                  "w-full flex items-start gap-3 px-3 py-2 rounded-md",
                                  "hover:bg-accent transition-colors",
                                  "text-left",
                                  isSelected && "bg-accent"
                                )}
                              >
                                <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-mono text-sm text-primary">
                                      {command.full_command}
                                    </span>
                                    {command.accepts_arguments && (
                                      <span className="text-xs text-muted-foreground">
                                        [args]
                                      </span>
                                    )}
                                    <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                      {command.scope}
                                    </span>
                                  </div>

                                  {command.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                      {command.description}
                                    </p>
                                  )}

                                  {/* Show argument hint for Codex commands */}
                                  {command.command_type === 'codex' && command.argument_hint && (
                                    <p className="text-xs font-mono text-blue-600 dark:text-blue-400 mt-0.5 truncate">
                                      {command.argument_hint}
                                    </p>
                                  )}

                                  <div className="flex items-center gap-3 mt-1">
                                    {command.allowed_tools && command.allowed_tools.length > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        {command.allowed_tools.length} tool{command.allowed_tools.length === 1 ? '' : 's'}
                                      </span>
                                    )}
                                    
                                    {command.has_bash_commands && (
                                      <span className="text-xs text-blue-600 dark:text-blue-400">
                                        Bash
                                      </span>
                                    )}
                                    
                                    {command.has_file_references && (
                                      <span className="text-xs text-green-600 dark:text-green-400">
                                        Files
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <p className="text-xs text-muted-foreground text-center">
          ↑↓ Navigate • Enter Select • Esc Close
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
