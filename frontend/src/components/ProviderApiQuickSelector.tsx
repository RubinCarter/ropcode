import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Globe, ChevronUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip-modern";
import { api } from "@/lib/api";
import { useProviderApiStore } from "@/stores/providerApiStore";
import { cn } from "@/lib/utils";

interface ProviderApiQuickSelectorProps {
  projectPath: string;
  providerId: string;
  disabled?: boolean;
  /** Current selected config ID (controlled by parent) */
  value?: string | null;
  onConfigChange?: (configId: string | null) => void;
  /**
   * Active interactive Claude session ID. When set and providerId === 'claude',
   * picking a config also pushes the new credentials into the running CLI
   * process via update_environment_variables (no restart required).
   */
  interactiveSessionId?: string | null;
  /**
   * Whether the active session currently has a turn in flight. Used purely so
   * the parent can decide whether to show a "takes effect after this turn"
   * notice; this component never interrupts the turn on its own.
   */
  isStreaming?: boolean;
  /**
   * Notify parent that a successful hot-swap happened mid-turn. Parent is
   * expected to render a transient banner — we don't show one here because
   * the popover is already closed by the time the swap returns.
   */
  onHotSwapDuringStream?: (configName: string) => void;
  className?: string;
}

/**
 * Provider API Quick Selector - Compact selector for chat input
 * Shows icon + indicator for current API configuration
 *
 * Note: This is a controlled component. The parent (FloatingPromptInput) manages
 * the selectedProviderApiId state and passes it via the `value` prop.
 * This component only loads configs for display and handles user selection.
 */
export const ProviderApiQuickSelector: React.FC<ProviderApiQuickSelectorProps> = ({
  projectPath,
  providerId,
  disabled = false,
  value,
  onConfigChange,
  interactiveSessionId,
  isStreaming = false,
  onHotSwapDuringStream,
  className,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Use global store for configs
  const { configs: allConfigs, isLoaded, isLoading } = useProviderApiStore();

  // Filter configs for current provider
  const configs = useMemo(() => {
    return allConfigs.filter(c => c.provider_id === providerId);
  }, [allConfigs, providerId]);

  // Use value from parent as the selected config ID
  const selectedConfigId = value ?? null;

  const handleConfigChange = async (configId: string) => {
    console.log('[ProviderApiQuickSelector] handleConfigChange called:', { configId, projectPath, providerId, interactiveSessionId, isStreaming });
    try {
      // Persist the user's choice on the project so future sessions inherit it.
      await api.setProjectProviderApiConfig(projectPath, providerId, configId);
      console.log('[ProviderApiQuickSelector] Config saved successfully');

      // Hot-swap the credentials on the running Claude session, if any.
      // Only Claude sessions support runtime env updates today; other
      // providers fall back to "next launch will use the new config".
      // We deliberately do NOT interrupt an in-flight turn — the parent shows
      // a notice instead so the user knows the swap takes effect on the next
      // request.
      if (providerId === 'claude' && interactiveSessionId) {
        try {
          await api.switchClaudeSessionProviderApi(interactiveSessionId, configId);
          console.log('[ProviderApiQuickSelector] Hot-swapped provider api on running session');
          if (isStreaming) {
            const swappedConfig = configs.find(c => c.id === configId);
            onHotSwapDuringStream?.(swappedConfig?.name ?? 'new API config');
          }
        } catch (hotSwapError) {
          // Don't block the picker — the persisted choice still takes effect
          // on the next launch. Surface the error so callers can react.
          console.error('[ProviderApiQuickSelector] Failed to hot-swap provider api:', hotSwapError);
        }
      }

      // Notify parent to update the value (controlled component pattern)
      onConfigChange?.(configId);
      setPickerOpen(false);
    } catch (error) {
      console.error("[ProviderApiQuickSelector] Failed to update provider config:", error);
    }
  };

  // Find configs
  const defaultConfig = configs.find(c => c.is_default);
  const currentConfig = selectedConfigId
    ? configs.find(c => c.id === selectedConfigId)
    : defaultConfig;

  // If no configs available, don't show the selector
  if (configs.length === 0) {
    return null;
  }

  return (
    <Popover
      trigger={
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || isLoading || !isLoaded}
                className={cn("h-9 px-1.5 hover:bg-accent/50 gap-0.5", className)}
              >
                <Globe className={cn(
                  "h-3.5 w-3.5",
                  selectedConfigId ? "text-primary" : "text-muted-foreground"
                )} />
                <span className="text-[10px] font-bold opacity-70">
                  {currentConfig?.name.substring(0, 1).toUpperCase() || "A"}
                </span>
                <ChevronUp className="h-3 w-3 opacity-50" />
              </Button>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs font-medium">
              API: {currentConfig?.name || "No Config"}
            </p>
            {currentConfig?.base_url && (
              <p className="text-xs text-muted-foreground font-mono">
                {currentConfig.base_url}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      }
      content={
        <div className="w-[280px] p-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b mb-1">
            Provider API Configuration
          </div>

          {/* Available configs */}
          {configs.filter(c => c.id).map((config) => (
            <button
              key={config.id}
              onClick={() => handleConfigChange(config.id!)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                "hover:bg-accent",
                selectedConfigId === config.id && "bg-accent"
              )}
            >
              <div className="mt-0.5">
                {selectedConfigId === config.id ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <div className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-medium text-sm flex items-center gap-2">
                  {config.name}
                  {config.is_default && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Default
                    </span>
                  )}
                </div>
                {config.base_url && (
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {config.base_url}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      }
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      align="start"
      side="top"
    />
  );
};
