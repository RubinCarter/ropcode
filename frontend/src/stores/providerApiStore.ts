import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { StateCreator } from 'zustand';
import { api, type ProviderApiConfig } from '@/lib/api';

interface ProviderApiState {
  // All provider API configs
  configs: ProviderApiConfig[];
  // Selected config ID per project+provider (key: `${projectPath}:${providerId}`)
  selectedConfigIds: Record<string, string>;
  // Loading state
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;

  // Actions
  loadConfigs: () => Promise<void>;
  refreshConfigs: () => Promise<void>;
  getSelectedConfigId: (projectPath: string, providerId: string) => string | null;
  setSelectedConfigId: (projectPath: string, providerId: string, configId: string) => void;
  loadProjectConfig: (projectPath: string, providerId: string) => Promise<string | null>;
  getDefaultConfigId: (providerId: string) => string | null;
}

const providerApiStore: StateCreator<
  ProviderApiState,
  [],
  [['zustand/subscribeWithSelector', never]],
  ProviderApiState
> = (set, get) => ({
  configs: [],
  selectedConfigIds: {},
  isLoading: false,
  isLoaded: false,
  error: null,

  // Load all provider API configs
  loadConfigs: async () => {
    const { isLoaded, isLoading } = get();
    if (isLoaded || isLoading) return;

    set({ isLoading: true, error: null });
    try {
      const configs = await api.listProviderApiConfigs();
      set({ configs, isLoading: false, isLoaded: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load provider API configs',
        isLoading: false,
        isLoaded: true, // Mark as loaded even on error to prevent infinite retries
      });
    }
  },

  // Refresh configs (force reload)
  refreshConfigs: async () => {
    set({ isLoading: true, error: null });
    try {
      const configs = await api.listProviderApiConfigs();
      set({ configs, isLoading: false, isLoaded: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh provider API configs',
        isLoading: false,
      });
    }
  },

  // Get selected config ID for a project+provider
  getSelectedConfigId: (projectPath: string, providerId: string) => {
    const key = `${projectPath}:${providerId}`;
    return get().selectedConfigIds[key] || null;
  },

  // Set selected config ID for a project+provider
  setSelectedConfigId: (projectPath: string, providerId: string, configId: string) => {
    const key = `${projectPath}:${providerId}`;
    set((state) => ({
      selectedConfigIds: {
        ...state.selectedConfigIds,
        [key]: configId,
      },
    }));
  },

  // Load project-specific config and cache it
  loadProjectConfig: async (projectPath: string, providerId: string) => {
    const key = `${projectPath}:${providerId}`;
    const { selectedConfigIds, configs } = get();

    // Return cached if exists
    if (selectedConfigIds[key]) {
      return selectedConfigIds[key];
    }

    try {
      // Try to get project-specific config
      const config = await api.getProjectProviderApiConfig(projectPath, providerId);
      if (config && config.id) {
        set((state) => ({
          selectedConfigIds: {
            ...state.selectedConfigIds,
            [key]: config.id!,
          },
        }));
        return config.id;
      }

      // Fallback to default config for this provider
      const providerConfigs = configs.filter((c) => c.provider_id === providerId);
      const defaultConfig = providerConfigs.find((c) => c.is_default);
      if (defaultConfig && defaultConfig.id) {
        set((state) => ({
          selectedConfigIds: {
            ...state.selectedConfigIds,
            [key]: defaultConfig.id!,
          },
        }));
        return defaultConfig.id;
      }

      return null;
    } catch (error) {
      console.error('Failed to load project provider config:', error);
      return null;
    }
  },

  // Get default config ID for a provider
  getDefaultConfigId: (providerId: string) => {
    const { configs } = get();
    const providerConfigs = configs.filter((c) => c.provider_id === providerId);
    const defaultConfig = providerConfigs.find((c) => c.is_default);
    return defaultConfig?.id || providerConfigs[0]?.id || null;
  },
});

export const useProviderApiStore = create<ProviderApiState>()(
  subscribeWithSelector(providerApiStore)
);
