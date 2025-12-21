import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, ChevronUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip-modern";
import { api, type ProviderApiConfig } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProviderApiQuickSelectorProps {
  projectPath: string;
  providerId: string;
  disabled?: boolean;
  onConfigChange?: (configId: string | null) => void;
  className?: string;
}

/**
 * Provider API Quick Selector - Compact selector for chat input
 * Shows icon + indicator for current API configuration
 */
export const ProviderApiQuickSelector: React.FC<ProviderApiQuickSelectorProps> = ({
  projectPath,
  providerId,
  disabled = false,
  onConfigChange,
  className,
}) => {
  const [configs, setConfigs] = useState<ProviderApiConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, [providerId]);

  useEffect(() => {
    loadProjectConfig();
  }, [projectPath, providerId]);

  const loadConfigs = async () => {
    try {
      console.log('[ProviderApiQuickSelector] Loading configs for provider:', providerId);
      const allConfigs = await api.listProviderApiConfigs();
      console.log('[ProviderApiQuickSelector] All configs:', allConfigs);
      const providerConfigs = allConfigs.filter(c => c.provider_id === providerId);
      console.log('[ProviderApiQuickSelector] Filtered configs:', providerConfigs);
      setConfigs(providerConfigs);
    } catch (error) {
      console.error("[ProviderApiQuickSelector] Failed to load provider API configs:", error);
    }
  };

  const loadProjectConfig = async () => {
    try {
      setLoading(true);
      const config = await api.getProjectProviderApiConfig(projectPath, providerId);

      // 如果项目已经保存了配置,使用保存的配置
      if (config && config.id) {
        setSelectedConfigId(config.id);
        onConfigChange?.(config.id);
      } else {
        // 否则,使用默认配置(仅在首次加载时)
        const allConfigs = await api.listProviderApiConfigs();
        const providerConfigs = allConfigs.filter(c => c.provider_id === providerId);
        const defaultConfig = providerConfigs.find(c => c.is_default);

        if (defaultConfig) {
          // 不保存到项目配置,只在内存中使用
          setSelectedConfigId(defaultConfig.id);
          onConfigChange?.(defaultConfig.id);
        } else {
          setSelectedConfigId(null);
          onConfigChange?.(null);
        }
      }
    } catch (error) {
      console.error("Failed to load project provider config:", error);
      setSelectedConfigId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = async (configId: string) => {
    console.log('[ProviderApiQuickSelector] handleConfigChange called:', { configId, projectPath, providerId });
    try {
      // 保存用户选择的配置到项目
      await api.setProjectProviderApiConfig(projectPath, providerId, configId);
      console.log('[ProviderApiQuickSelector] Config saved successfully');
      setSelectedConfigId(configId);
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
                disabled={disabled || loading}
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
          {configs.map((config) => (
            <button
              key={config.id}
              onClick={() => handleConfigChange(config.id)}
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
