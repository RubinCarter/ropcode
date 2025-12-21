import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  X,
  Sparkles,
  FolderOpen,
  Globe,
  Puzzle,
  AlertCircle,
  User,
  Building2
} from "lucide-react";
import type { Skill, SkillScope } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SkillPickerProps {
  /**
   * The project path for loading project-specific skills
   */
  projectPath?: string;
  /**
   * Callback when a skill is selected
   */
  onSelect: (skill: Skill) => void;
  /**
   * Callback to close the picker
   */
  onClose: () => void;
  /**
   * Initial search query (text after :)
   */
  initialQuery?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Optional anchor element ref for positioning the picker
   * If provided, the picker will be rendered via portal and positioned relative to the anchor
   */
  anchorRef?: React.RefObject<HTMLElement>;
}

// Get icon for skill based on its scope
const getSkillIcon = (scope: SkillScope) => {
  switch (scope) {
    case "project":
      return FolderOpen;
    case "user":
      return Globe;
    case "plugin":
      return Puzzle;
    default:
      return Sparkles;
  }
};

// Get scope display name
const getScopeDisplayName = (scope: SkillScope): string => {
  switch (scope) {
    case "project":
      return "Project Skills";
    case "user":
      return "User Skills";
    case "plugin":
      return "Plugin Skills";
    default:
      return "Skills";
  }
};

/**
 * SkillPicker component - Autocomplete UI for skills
 *
 * @example
 * <SkillPicker
 *   projectPath="/Users/example/project"
 *   onSelect={(skill) => console.log('Selected:', skill)}
 *   onClose={() => setShowPicker(false)}
 * />
 */
export const SkillPicker: React.FC<SkillPickerProps> = ({
  projectPath,
  onSelect,
  onClose,
  initialQuery = "",
  className,
  anchorRef,
}) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filteredSkills, setFilteredSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const skillListRef = useRef<HTMLDivElement>(null);

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

  // Load skills on mount or when project path changes
  useEffect(() => {
    loadSkills();
  }, [projectPath]);

  // Filter skills based on search query
  useEffect(() => {
    if (!skills.length) {
      setFilteredSkills([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    let filtered = skills;

    // Filter by search query
    if (query) {
      filtered = filtered.filter(skill => {
        // Match against skill name
        if (skill.name.toLowerCase().includes(query)) return true;

        // Match against full name
        if (skill.full_name.toLowerCase().includes(query)) return true;

        // Match against plugin name
        if (skill.plugin_name && skill.plugin_name.toLowerCase().includes(query)) return true;

        // Match against description
        if (skill.description && skill.description.toLowerCase().includes(query)) return true;

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

    setFilteredSkills(filtered);

    // Reset selected index when filtered list changes
    setSelectedIndex(0);
  }, [searchQuery, skills]);

  // Group skills by scope - computed before keyboard navigation
  const { groupedSkills, sortedGroupKeys, orderedSkills } = useMemo(() => {
    const grouped = filteredSkills.reduce((acc, skill) => {
      const key = getScopeDisplayName(skill.scope);

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(skill);
      return acc;
    }, {} as Record<string, Skill[]>);

    // Sort group keys: Project first, then User, then Plugin
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const order = (key: string) => {
        if (key === "Project Skills") return 0;
        if (key === "User Skills") return 1;
        if (key === "Plugin Skills") return 2;
        return 3;
      };
      return order(a) - order(b);
    });

    // Create flat list in render order for keyboard navigation
    const ordered = sortedKeys.flatMap(key => grouped[key]);

    return { groupedSkills: grouped, sortedGroupKeys: sortedKeys, orderedSkills: ordered };
  }, [filteredSkills]);

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
          if (orderedSkills.length > 0 && selectedIndex < orderedSkills.length) {
            const skill = orderedSkills[selectedIndex];
            onSelect(skill);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(orderedSkills.length - 1, prev + 1));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orderedSkills, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (skillListRef.current) {
      const selectedElement = skillListRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const loadSkills = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Always load fresh skills from filesystem
      const loadedSkills = await api.skillsList(projectPath);
      setSkills(loadedSkills);
    } catch (err) {
      console.error("Failed to load skills:", err);
      setError(err instanceof Error ? err.message : 'Failed to load skills');
      setSkills([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkillClick = (skill: Skill) => {
    onSelect(skill);
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
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Skills</span>
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

      {/* Skill List */}
      <div className="flex-1 overflow-y-auto relative">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-muted-foreground">Loading skills...</span>
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
            {filteredSkills.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full">
                <Sparkles className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? 'No skills found' : 'No skills available'}
                </span>
                {!searchQuery && (
                  <p className="text-xs text-muted-foreground mt-2 text-center px-4">
                    Create skills in <code className="px-1">.claude/skills/</code>, <code className="px-1">~/.claude/skills/</code>, or install plugins with skills
                  </p>
                )}
              </div>
            )}

            {orderedSkills.length > 0 && (
              <div className="p-2" ref={skillListRef}>
                {/* If no grouping needed, show flat list */}
                {sortedGroupKeys.length === 1 ? (
                  <div className="space-y-0.5">
                    {orderedSkills.map((skill, index) => {
                      const Icon = getSkillIcon(skill.scope);
                      const isSelected = index === selectedIndex;

                      return (
                        <button
                          key={skill.id}
                          data-index={index}
                          onClick={() => handleSkillClick(skill)}
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
                                {skill.full_name}
                              </span>
                              <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                {skill.scope}
                              </span>
                            </div>

                            {skill.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {skill.description}
                              </p>
                            )}

                            {skill.plugin_name && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-blue-600 dark:text-blue-400">
                                  {skill.plugin_name}
                                </span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  // Show grouped by scope
                  <div className="space-y-4">
                    {sortedGroupKeys.map((groupKey) => {
                      const ScopeIcon = groupKey === "Project Skills" ? Building2
                        : groupKey === "User Skills" ? User
                        : Puzzle;

                      return (
                        <div key={groupKey}>
                          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1 flex items-center gap-2">
                            <ScopeIcon className="h-3 w-3" />
                            {groupKey}
                          </h3>

                          <div className="space-y-0.5">
                            {groupedSkills[groupKey].map((skill) => {
                              const Icon = getSkillIcon(skill.scope);
                              const globalIndex = orderedSkills.indexOf(skill);
                              const isSelected = globalIndex === selectedIndex;

                              return (
                                <button
                                  key={skill.id}
                                  data-index={globalIndex}
                                  onClick={() => handleSkillClick(skill)}
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
                                        {skill.full_name}
                                      </span>
                                      {skill.plugin_name && (
                                        <span className="text-xs text-blue-600 dark:text-blue-400">
                                          {skill.plugin_name}
                                        </span>
                                      )}
                                    </div>

                                    {skill.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                        {skill.description}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
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
