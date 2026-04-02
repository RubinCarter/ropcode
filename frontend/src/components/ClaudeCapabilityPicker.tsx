import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Building2,
  Command,
  Layers3,
  Sparkles,
  User,
  X,
} from "lucide-react";
import type { ClaudeCapability, ClaudeCapabilityLayers } from "@/lib/rpc-client";

interface ClaudeCapabilityPickerProps {
  projectPath?: string;
  initialQuery?: string;
  onSelect: (capability: ClaudeCapability) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

type ScopeGroupKey = "project" | "user" | "system";

const SCOPE_ORDER: ScopeGroupKey[] = ["project", "user", "system"];

const getScopeLabel = (scope: ScopeGroupKey): string => {
  switch (scope) {
    case "project":
      return "Project";
    case "user":
      return "User";
    case "system":
      return "System";
  }
};

const getScopeIcon = (scope: ScopeGroupKey) => {
  switch (scope) {
    case "project":
      return Building2;
    case "user":
      return User;
    case "system":
      return Layers3;
  }
};

const getKindLabel = (kind: ClaudeCapability["kind"]): string => {
  return kind === "command" ? "Command" : "Skill";
};

const getArgumentHint = (capability: ClaudeCapability): string | undefined => {
  const capabilityWithAlias = capability as ClaudeCapability & { argumentHint?: string };
  return capabilityWithAlias.argumentHint ?? capability.argument_hint ?? undefined;
};

const getSearchRank = (capability: ClaudeCapability, query: string): number => {
  const normalizedQuery = query.toLowerCase();
  const name = capability.name.toLowerCase();
  const slashName = capability.slash_name.toLowerCase();

  if (slashName === normalizedQuery || name === normalizedQuery) return 0;
  if (slashName === `/${normalizedQuery}`) return 0;
  if (slashName.startsWith(normalizedQuery) || name.startsWith(normalizedQuery)) return 1;
  if (slashName.includes(normalizedQuery) || name.includes(normalizedQuery)) return 2;
  if (capability.description?.toLowerCase().includes(normalizedQuery)) return 3;
  return 4;
};

const compareCapabilities = (a: ClaudeCapability, b: ClaudeCapability, query?: string): number => {
  if (query) {
    const rankDifference = getSearchRank(a, query) - getSearchRank(b, query);
    if (rankDifference !== 0) return rankDifference;
  }

  const kindDifference = (a.kind === "command" ? 0 : 1) - (b.kind === "command" ? 0 : 1);
  if (kindDifference !== 0) return kindDifference;

  return a.slash_name.localeCompare(b.slash_name);
};

export const ClaudeCapabilityPicker: React.FC<ClaudeCapabilityPickerProps> = ({
  projectPath,
  initialQuery = "",
  onSelect,
  onClose,
  anchorRef,
}) => {
  const [capabilities, setCapabilities] = useState<ClaudeCapability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const capabilityListRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setSearchQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const loadCapabilities = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const layers: ClaudeCapabilityLayers = await api.getClaudeCapabilityLayers(projectPath);
        setCapabilities(layers.all_visible ?? []);
      } catch (err) {
        console.error("Failed to load Claude capabilities:", err);
        setError(err instanceof Error ? err.message : "Failed to load capabilities");
        setCapabilities([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadCapabilities();
  }, [projectPath]);

  const filteredCapabilities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = capabilities;

    if (query) {
      filtered = capabilities.filter((capability: ClaudeCapability) => {
        if (capability.name.toLowerCase().includes(query)) return true;
        if (capability.slash_name.toLowerCase().includes(query)) return true;
        if (capability.description?.toLowerCase().includes(query)) return true;
        return false;
      });
    }

    return [...filtered].sort((a, b) => compareCapabilities(a, b, query || undefined));
  }, [capabilities, searchQuery]);

  const { groupedCapabilities, orderedCapabilities, visibleGroups } = useMemo(() => {
    const grouped: Record<ScopeGroupKey, ClaudeCapability[]> = {
      project: [],
      user: [],
      system: [],
    };

    for (const capability of filteredCapabilities) {
      const scope = capability.scope as ScopeGroupKey;
      if (scope in grouped) {
        grouped[scope].push(capability);
      }
    }

    const groups = SCOPE_ORDER.filter((scope) => grouped[scope].length > 0);
    const ordered = groups.flatMap((scope) => grouped[scope]);

    return {
      groupedCapabilities: grouped,
      orderedCapabilities: ordered,
      visibleGroups: groups,
    };
  }, [filteredCapabilities]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCapabilities]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Enter":
          e.preventDefault();
          if (orderedCapabilities.length > 0 && selectedIndex < orderedCapabilities.length) {
            onSelect(orderedCapabilities[selectedIndex]);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev: number) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev: number) => Math.min(orderedCapabilities.length - 1, prev + 1));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onSelect, orderedCapabilities, selectedIndex]);

  useEffect(() => {
    if (!capabilityListRef.current) return;

    const selectedElement = capabilityListRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const usePortal = !!anchorRef && !!position;

  const renderCapabilityRow = (capability: ClaudeCapability, index: number) => {
    const isSelected = index === selectedIndex;
    const argumentHint = getArgumentHint(capability);

    return (
      <button
        key={capability.key}
        data-index={index}
        onClick={() => onSelect(capability)}
        onMouseEnter={() => setSelectedIndex(index)}
        className={cn(
          "w-full flex items-start gap-3 px-3 py-2 rounded-md",
          "hover:bg-accent transition-colors text-left",
          isSelected && "bg-accent"
        )}
      >
        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground flex-shrink-0">
          {capability.kind === "command" ? (
            <Command className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-primary">{capability.slash_name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {getKindLabel(capability.kind)}
            </span>
          </div>

          {argumentHint && (
            <p className="mt-0.5 truncate font-mono text-xs text-blue-600 dark:text-blue-400">
              {argumentHint}
            </p>
          )}

          {capability.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {capability.description}
            </p>
          )}
        </div>
      </button>
    );
  };

  const pickerContent = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={cn(
        usePortal ? "fixed z-[9999]" : "absolute bottom-full left-0 z-50 mb-2",
        isMobile ? "w-[calc(100vw-8px)]" : "w-[600px]",
        "flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg",
        "will-change-transform transform-gpu"
      )}
      style={usePortal && position ? { top: position.top, left: position.left, height: pickerHeight } : { height: pickerHeight }}
    >
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Claude Capabilities</span>
            {searchQuery && (
              <span className="truncate text-xs text-muted-foreground">
                Searching: "{searchQuery}"
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading capabilities...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center p-4">
            <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
            <span className="text-center text-sm text-destructive">{error}</span>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {orderedCapabilities.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <Sparkles className="mb-2 h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {searchQuery ? "No capabilities found" : "No capabilities available"}
                </span>
              </div>
            )}

            {orderedCapabilities.length > 0 && (
              <div ref={capabilityListRef} className="space-y-4 p-2">
                {visibleGroups.map((scope) => {
                  const ScopeIcon = getScopeIcon(scope);
                  return (
                    <div key={scope}>
                      <h3 className="mb-1 flex items-center gap-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <ScopeIcon className="h-3 w-3" />
                        {getScopeLabel(scope)}
                      </h3>

                      <div className="space-y-0.5">
                        {groupedCapabilities[scope].map((capability) => {
                          const globalIndex = orderedCapabilities.indexOf(capability);
                          return renderCapabilityRow(capability, globalIndex);
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border p-2">
        <p className="text-center text-xs text-muted-foreground">↑↓ Navigate • Enter Select • Esc Close</p>
      </div>
    </motion.div>
  );

  if (usePortal) {
    return createPortal(pickerContent, document.body);
  }

  return pickerContent;
};
