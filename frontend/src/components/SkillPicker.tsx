import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { main } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  X,
  Sparkles,
  AlertCircle,
  User,
  Building2,
  Puzzle,
} from "lucide-react";

interface SkillPickerProps {
  /**
   * The project path for loading project-specific skills
   */
  projectPath?: string;
  /**
   * Callback when a skill is selected
   */
  onSelect: (skill: main.Skill) => void;
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
   */
  anchorRef?: React.RefObject<HTMLElement>;
}

type Skill = main.Skill & {
  full_name?: string;
  scope?: string;
  description?: string;
};

const getScopeIcon = (scope?: string) => {
  switch (scope) {
    case "user":
      return User;
    case "project":
      return Building2;
    case "plugin":
      return Puzzle;
    default:
      return Sparkles;
  }
};

export const SkillPicker: React.FC<SkillPickerProps> = ({
  projectPath,
  onSelect,
  onClose,
  initialQuery = "",
  className,
  anchorRef,
}) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const skillListRef = useRef<HTMLDivElement>(null);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const pickerHeight = isMobile ? Math.min(300, window.innerHeight * 0.5) : 400;

  useLayoutEffect(() => {
    if (!anchorRef?.current) return;

    const updatePosition = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 10;
      let top = rect.top - pickerHeight - margin;
      if (top < 0) top = 4;
      setPosition({
        top,
        left: isMobile ? 4 : rect.left,
      });
    };

    updatePosition();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", updatePosition);
      vv.addEventListener("scroll", updatePosition);
    }
    window.addEventListener("resize", updatePosition);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", updatePosition);
        vv.removeEventListener("scroll", updatePosition);
      }
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef, pickerHeight, isMobile]);

  // Load skills
  useEffect(() => {
    const loadSkills = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const loaded = await api.skillsList(projectPath || "");
        setSkills(loaded || []);
      } catch (err) {
        console.error("Failed to load skills:", err);
        setError(err instanceof Error ? err.message : "Failed to load skills");
        setSkills([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadSkills();
  }, [projectPath]);

  useEffect(() => {
    setSearchQuery(initialQuery);
  }, [initialQuery]);

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;

    const filtered = skills.filter((skill) => {
      if (skill.name.toLowerCase().includes(query)) return true;
      if (skill.full_name?.toLowerCase().includes(query)) return true;
      if (skill.description?.toLowerCase().includes(query)) return true;
      return false;
    });

    filtered.sort((a, b) => {
      const aExact = a.name.toLowerCase() === query;
      const bExact = b.name.toLowerCase() === query;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.name.toLowerCase().startsWith(query);
      const bStarts = b.name.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [skills, searchQuery]);

  const { groupedSkills, sortedGroupKeys, orderedSkills } = useMemo(() => {
    const grouped = filteredSkills.reduce((acc, skill) => {
      let key: string;
      if (skill.scope === "plugin") {
        key = "Plugin Skills";
      } else if (skill.scope === "user") {
        key = "User Skills";
      } else if (skill.scope === "project") {
        key = "Project Skills";
      } else {
        key = "Skills";
      }

      if (!acc[key]) acc[key] = [];
      acc[key].push(skill);
      return acc;
    }, {} as Record<string, Skill[]>);

    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      const order = (key: string) => {
        if (key.startsWith("Project")) return 0;
        if (key.startsWith("User")) return 1;
        if (key.startsWith("Plugin")) return 2;
        return 3;
      };
      return order(a) - order(b);
    });

    const ordered = sortedKeys.flatMap((key) => grouped[key]);
    return { groupedSkills: grouped, sortedGroupKeys: sortedKeys, orderedSkills: ordered };
  }, [filteredSkills]);

  // Reset selected index when list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [orderedSkills.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Enter":
          e.preventDefault();
          if (orderedSkills.length > 0 && selectedIndex < orderedSkills.length) {
            onSelect(orderedSkills[selectedIndex]);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(orderedSkills.length - 1, prev + 1));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [orderedSkills, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (skillListRef.current) {
      const selectedElement = skillListRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  const usePortal = !!anchorRef && !!position;

  const pickerContent = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        usePortal ? "fixed z-[9999]" : "absolute bottom-full mb-2 left-0 z-50",
        isMobile ? "w-[calc(100vw-8px)]" : "w-[600px]",
        "bg-background border border-border rounded-lg shadow-lg",
        "flex flex-col overflow-hidden",
        "will-change-transform transform-gpu",
        className,
      )}
      style={
        usePortal && position
          ? { top: position.top, left: position.left, height: pickerHeight }
          : { height: pickerHeight }
      }
    >
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Skills</span>
            {searchQuery && (
              <span className="text-xs text-muted-foreground">
                Searching: &quot;{searchQuery}&quot;
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
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
            {orderedSkills.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full">
                <Sparkles className="h-8 w-8 text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? "No skills found" : "No skills available"}
                </span>
              </div>
            )}

            {orderedSkills.length > 0 && (
              <div className="p-2" ref={skillListRef}>
                {sortedGroupKeys.length <= 1 ? (
                  <div className="space-y-0.5">
                    {orderedSkills.map((skill, index) => {
                      const Icon = getScopeIcon(skill.scope);
                      const isSelected = index === selectedIndex;
                      return (
                        <button
                          key={skill.full_name || skill.name}
                          data-index={index}
                          onClick={() => onSelect(skill)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            "w-full flex items-start gap-3 px-3 py-2 rounded-md",
                            "hover:bg-accent transition-colors text-left",
                            isSelected && "bg-accent",
                          )}
                        >
                          <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-sm text-primary">
                                {skill.full_name || `:${skill.name}`}
                              </span>
                              {skill.scope && (
                                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                  {skill.scope}
                                </span>
                              )}
                            </div>
                            {skill.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {skill.description}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sortedGroupKeys.map((groupKey) => {
                      const firstSkill = groupedSkills[groupKey][0];
                      const GroupIcon = getScopeIcon(firstSkill?.scope);
                      return (
                        <div key={groupKey}>
                          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1 flex items-center gap-2">
                            <GroupIcon className="h-3 w-3" />
                            {groupKey}
                          </h3>
                          <div className="space-y-0.5">
                            {groupedSkills[groupKey].map((skill) => {
                              const globalIndex = orderedSkills.indexOf(skill);
                              const isSelected = globalIndex === selectedIndex;
                              const Icon = getScopeIcon(skill.scope);
                              return (
                                <button
                                  key={skill.full_name || skill.name}
                                  data-index={globalIndex}
                                  onClick={() => onSelect(skill)}
                                  onMouseEnter={() => setSelectedIndex(globalIndex)}
                                  className={cn(
                                    "w-full flex items-start gap-3 px-3 py-2 rounded-md",
                                    "hover:bg-accent transition-colors text-left",
                                    isSelected && "bg-accent",
                                  )}
                                >
                                  <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                      <span className="font-mono text-sm text-primary">
                                        {skill.full_name || `:${skill.name}`}
                                      </span>
                                      {skill.scope && (
                                        <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                          {skill.scope}
                                        </span>
                                      )}
                                    </div>
                                    {skill.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
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

  if (usePortal) {
    return createPortal(pickerContent, document.body);
  }

  return pickerContent;
};
