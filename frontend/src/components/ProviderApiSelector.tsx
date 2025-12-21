import React, { useState, useEffect } from "react";
import { Globe, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type ProviderApiConfig } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProviderApiSelectorProps {
  projectPath: string;
  providerId: string;
  className?: string;
  onConfigChanged?: (configId: string | null) => void;
}

/**
 * Provider API Selector Component
 * Allows selecting which API configuration to use for a specific project/provider
 */
export const ProviderApiSelector: React.FC<ProviderApiSelectorProps> = ({
  projectPath,
  providerId,
  className,
  onConfigChanged,
}) => {
  const [configs, setConfigs] = useState<ProviderApiConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfigs();
    loadProjectConfig();
  }, [projectPath, providerId]);

  const loadConfigs = async () => {
    try {
      const allConfigs = await api.listProviderApiConfigs();
      // Filter configs for this provider
      const providerConfigs = allConfigs.filter(c => c.provider_id === providerId);
      setConfigs(providerConfigs);
    } catch (error) {
      console.error("Failed to load provider API configs:", error);
      setError("Failed to load configurations");
    }
  };

  const loadProjectConfig = async () => {
    try {
      setLoading(true);
      const configId = await api.getProjectProviderApiConfig(projectPath, providerId);
      setSelectedConfigId(configId);
    } catch (error) {
      console.error("Failed to load project provider config:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = async (configId: string) => {
    try {
      setSaving(true);
      setError(null);

      if (configId === "default") {
        // Clear the project-specific setting
        setSelectedConfigId(null);
        // Note: We may need a backend API to clear the setting
        // For now, we'll just update the state
      } else {
        await api.setProjectProviderApiConfig(projectPath, providerId, configId);
        setSelectedConfigId(configId);
      }

      if (onConfigChanged) {
        onConfigChanged(configId === "default" ? null : configId);
      }
    } catch (error) {
      console.error("Failed to update provider config:", error);
      setError("Failed to update configuration");
    } finally {
      setSaving(false);
    }
  };

  // Find the default config
  const defaultConfig = configs.find(c => c.is_default);

  // Find the currently selected config
  const currentConfig = selectedConfigId
    ? configs.find(c => c.id === selectedConfigId)
    : defaultConfig;

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-4", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed p-6 text-center", className)}>
        <Globe className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No API configurations available for {providerId}.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Create one in Settings → Providers
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Label htmlFor="api-config">API Configuration</Label>
        <Select
          value={selectedConfigId || "default"}
          onValueChange={handleConfigChange}
          disabled={saving}
        >
          <SelectTrigger id="api-config" className="w-full">
            <SelectValue placeholder="Select API configuration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              <div className="flex items-center gap-2">
                <span>Use Default</span>
                {defaultConfig && (
                  <span className="text-xs text-muted-foreground">
                    ({defaultConfig.name})
                  </span>
                )}
              </div>
            </SelectItem>
            {configs.map((config) => (
              <SelectItem key={config.id} value={config.id}>
                <div className="flex items-center gap-2">
                  <span>{config.name}</span>
                  {config.is_default && (
                    <span className="text-xs text-muted-foreground">(Default)</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          Choose which API endpoint to use for this project
        </p>
      </div>

      {/* Current Configuration Info */}
      {currentConfig && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {selectedConfigId ? "Custom Configuration" : "Using Default"}
            </span>
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium">Name:</span>
              <span>{currentConfig.name}</span>
            </div>

            {currentConfig.base_url && (
              <div className="flex items-center gap-2">
                <span className="font-medium">URL:</span>
                <span className="font-mono">{currentConfig.base_url}</span>
              </div>
            )}

            {currentConfig.auth_token && (
              <div className="flex items-center gap-2">
                <span className="font-medium">Auth:</span>
                <span className="font-mono">
                  {currentConfig.auth_token.substring(0, 15)}...
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Saving Indicator */}
      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving configuration...</span>
        </div>
      )}
    </div>
  );
};
