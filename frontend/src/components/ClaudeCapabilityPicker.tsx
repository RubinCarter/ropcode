import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
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

type CapabilityLayersState = Pick<ClaudeCapabilityLayers, "system" | "user_only" | "project_only" | "all_visible">;

const EMPTY_LAYERS: CapabilityLayersState = {
  system: [],
  user_only: [],
  project_only: [],
  all_visible: [],
};

const SCOPE_ORDER: ScopeGroupKey[] = ["project", "user", "system"];

const normalizeLayers = (layers?: Partial<CapabilityLayersState> | ClaudeCapabilityLayers | null): CapabilityLayersState => {
  const system = layers?.system ?? [];
  const userOnly = layers?.user_only ?? [];
  const projectOnly = layers?.project_only ?? [];

  return {
    system,
    user_only: userOnly,
    project_only: projectOnly,
    all_visible: layers?.all_visible ?? [...projectOnly, ...userOnly, ...system],
  };
};

const getCachedVisibleLayers = (layers?: Partial<CapabilityLayersState> | ClaudeCapabilityLayers | null): CapabilityLayersState => {
  const normalized = normalizeLayers(layers);
  return {
    system: normalized.system,
    user_only: normalized.user_only,
    project_only: [],
    all_visible: [...normalized.user_only, ...normalized.system],
  };
};

const getErrorMessage = (err: unknown, fallback: string): string => {
  return err instanceof Error ? err.message : fallback;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
  const [capabilityLayers, setCapabilityLayers] = useState<CapabilityLayersState>(EMPTY_LAYERS);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const capabilityListRef = useRef<HTMLDivElement>(null);
  const selectedCapabilityKeyRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);

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

  const loadCapabilities = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    const isCurrentRequest = () => loadRequestIdRef.current === requestId;
    const applyLayers = (layers: CapabilityLayersState) => {
      if (!isCurrentRequest()) return;
      setCapabilityLayers(layers);
    };
    const applyError = (nextError: string | null) => {
      if (!isCurrentRequest()) return;
      setError(nextError);
    };
    const applyInitialLoading = (nextValue: boolean) => {
      if (!isCurrentRequest()) return;
      setIsInitialLoading(nextValue);
    };
    const applyProjectLoading = (nextValue: boolean) => {
      if (!isCurrentRequest()) return;
      setIsProjectLoading(nextValue);
    };
    const applyRefreshing = (nextValue: boolean) => {
      if (!isCurrentRequest()) return;
      setIsRefreshing(nextValue);
    };

    let startedBackgroundRefresh = false;

    applyInitialLoading(true);
    applyError(null);

    const startBackgroundRefresh = () => {
      startedBackgroundRefresh = true;
      applyProjectLoading(Boolean(projectPath));

      void api.refreshClaudeCapabilityLayers(projectPath)
        .then((layers: ClaudeCapabilityLayers) => {
          applyLayers(normalizeLayers(layers));
          applyError(null);
        })
        .catch((err: unknown) => {
          console.error("Failed to refresh Claude capabilities:", err);
          applyError(getErrorMessage(err, "Failed to refresh project capabilities"));
        })
        .finally(() => {
          applyProjectLoading(false);
          applyRefreshing(false);
        });
    };

    try {
      const cached = projectPath ? await api.getCachedClaudeCapabilityLayers(projectPath) : null;
      const cachedVisibleLayers = getCachedVisibleLayers(cached);
      const hasCachedVisibleLayers = cachedVisibleLayers.all_visible.length > 0;

      if (hasCachedVisibleLayers) {
        applyLayers(cachedVisibleLayers);
        applyInitialLoading(false);
        startBackgroundRefresh();
        return;
      }

      if (projectPath) {
        applyProjectLoading(true);
        void api.prewarmClaudeCapabilityLayers(projectPath).catch(() => undefined);

        for (let attempt = 0; attempt < 8; attempt += 1) {
          await sleep(150);
          if (!isCurrentRequest()) return;

          const warmed = await api.getCachedClaudeCapabilityLayers(projectPath);
          const warmedVisibleLayers = getCachedVisibleLayers(warmed);
          if (warmedVisibleLayers.all_visible.length > 0) {
            applyLayers(warmedVisibleLayers);
            applyInitialLoading(false);
            startBackgroundRefresh();
            return;
          }
        }
      }

      const layers: ClaudeCapabilityLayers = await api.getClaudeCapabilityLayers(projectPath);
      applyLayers(normalizeLayers(layers));
      applyError(null);
    } catch (err) {
      console.error("Failed to load Claude capabilities:", err);
      applyError(getErrorMessage(err, "Failed to load capabilities"));
      applyLayers(EMPTY_LAYERS);
    } finally {
      applyInitialLoading(false);
      if (!startedBackgroundRefresh) {
        applyProjectLoading(false);
        applyRefreshing(false);
      }
    }
  }, [projectPath]);

  const refreshCapabilities = useCallback(async () => {
    try {
      setIsRefreshing(true);
      setIsProjectLoading(Boolean(projectPath));
      setError(null);
      const layers: ClaudeCapabilityLayers = await api.refreshClaudeCapabilityLayers(projectPath);
      setCapabilityLayers(normalizeLayers(layers));
    } catch (err) {
      console.error("Failed to refresh Claude capabilities:", err);
      setError(getErrorMessage(err, "Failed to refresh capabilities"));
    } finally {
      setIsRefreshing(false);
      setIsProjectLoading(false);
      setIsInitialLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const filteredCapabilities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = capabilityLayers.all_visible;

    if (query) {
      filtered = capabilityLayers.all_visible.filter((capability: ClaudeCapability) => {
        if (capability.name.toLowerCase().includes(query)) return true;
        if (capability.slash_name.toLowerCase().includes(query)) return true;
        if (capability.description?.toLowerCase().includes(query)) return true;
        return false;
      });
    }

    return [...filtered].sort((a, b) => compareCapabilities(a, b, query || undefined));
  }, [capabilityLayers, searchQuery]);

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

  const hasAnyCapabilities = capabilityLayers.all_visible.length > 0;
  const projectCapabilityCount = capabilityLayers.project_only.length;
  const showFullScreenLoading = isInitialLoading && !hasAnyCapabilities;
  const showInlineProjectLoading = isProjectLoading && hasAnyCapabilities;
  const showEmptyState = !showFullScreenLoading && orderedCapabilities.length === 0;
  const showBlockingError = Boolean(error) && !hasAnyCapabilities;

  useEffect(() => {
    const nextSelectedCapability = orderedCapabilities[selectedIndex];
    selectedCapabilityKeyRef.current = nextSelectedCapability?.key ?? null;
  }, [orderedCapabilities, selectedIndex]);

  useEffect(() => {
    if (orderedCapabilities.length === 0) {
      if (selectedIndex !== 0) {
        setSelectedIndex(0);
      }
      selectedCapabilityKeyRef.current = null;
      return;
    }

    const selectedKey = selectedCapabilityKeyRef.current;
    if (selectedKey) {
      const preservedIndex = orderedCapabilities.findIndex((capability) => capability.key === selectedKey);
      if (preservedIndex >= 0) {
        if (preservedIndex !== selectedIndex) {
          setSelectedIndex(preservedIndex);
        }
        return;
      }
    }

    if (selectedIndex >= orderedCapabilities.length) {
      setSelectedIndex(orderedCapabilities.length - 1);
    }
  }, [orderedCapabilities, selectedIndex]);

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
          <div className="flex items-center gap-2">
            {showInlineProjectLoading && (
              <span className="text-xs text-muted-foreground">
                Loading project capabilities{projectCapabilityCount > 0 ? ` (${projectCapabilityCount})` : ""}...
              </span>
            )}
            {error && hasAnyCapabilities && (
              <span className="max-w-[220px] truncate text-xs text-destructive" title={error}>
                {error}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refreshCapabilities()}
              className="h-8 w-8"
              disabled={isRefreshing}
              aria-label="Refresh capabilities"
              title="Refresh capabilities"
            >
              <RefreshCw className={cn("h-4 w-4", (isRefreshing || showInlineProjectLoading) && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto">
        {showFullScreenLoading && (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading capabilities...</span>
          </div>
        )}

        {showBlockingError && (
          <div className="flex h-full flex-col items-center justify-center p-4">
            <AlertCircle className="mb-2 h-8 w-8 text-destructive" />
            <span className="text-center text-sm text-destructive">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadCapabilities()}
              className="mt-4 gap-2"
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              {isRefreshing ? "Retrying..." : "Retry refresh"}
            </Button>
          </div>
        )}

        {!showFullScreenLoading && !showBlockingError && (
          <>
            {showEmptyState && (
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
                        {scope === "project" && showInlineProjectLoading && groupedCapabilities.project.length === 0 && (
                          <span className="text-[10px] normal-case tracking-normal text-muted-foreground/80">Loading…</span>
                        )}
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
