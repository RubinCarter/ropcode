import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  FileArchive,
  FolderInput,
  GitBranch,
  Globe,
  History,
  Loader2,
  PackageOpen,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type AgentRunWithMetrics, type ModelConfig, type ProviderApiConfig } from '@/lib/api';
import type { agentpacks } from '@/lib/rpc-client';
import { open as openDialog } from '@/lib/dialog';
import { useTabState } from '@/hooks/useTabState';
import { useProcessChanged } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { CreateAgent } from '@/components/CreateAgent';

type ToastState = { message: string; type: 'success' | 'error' } | null;
type ProviderID = 'claude' | 'codex' | 'gemini' | 'pi' | 'deepseek';
type AgentConfigPatch = Omit<Partial<agentpacks.InstalledAgentConfig>, 'runtime'> & {
  runtime?: Partial<agentpacks.RuntimeConfig>;
};

const PROVIDERS: Array<{ id: ProviderID; label: string; detail: string }> = [
  { id: 'claude', label: 'Claude', detail: 'Claude Code' },
  { id: 'codex', label: 'Codex', detail: 'OpenAI Codex' },
  { id: 'gemini', label: 'Gemini', detail: 'Gemini CLI' },
  { id: 'pi', label: 'Pi', detail: 'Pi Agent' },
  { id: 'deepseek', label: 'DeepSeek', detail: 'DeepSeek CLI' },
];

const FALLBACK_MODELS: Record<string, string[]> = {
  claude: ['sonnet', 'opus', 'haiku'],
  codex: ['gpt-5', 'gpt-5-codex'],
  gemini: ['gemini-pro'],
  pi: ['default'],
  deepseek: ['deepseek-chat'],
};

const deferUntilIdle = (callback: () => void, timeout = 800): (() => void) => {
  const win = window as typeof window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (win.requestIdleCallback) {
    const id = win.requestIdleCallback(callback, { timeout });
    return () => win.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
};

const providerLabel = (provider: string): string => {
  return PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
};

const triggerSummary = (triggers?: agentpacks.TriggerConfig[]): string => {
  const enabled = (triggers ?? []).filter((trigger) => trigger.enabled !== false);
  if (enabled.length === 0) {
    return 'No automation';
  }
  const schedules = enabled.filter((trigger) => trigger.mode === 'schedule' || trigger.mode === 'scheduled');
  const events = enabled.filter((trigger) => trigger.mode === 'event');
  const manuals = enabled.filter((trigger) => trigger.mode === 'manual');
  const parts: string[] = [];
  if (manuals.length > 0) {
    parts.push('Manual');
  }
  if (schedules.length > 0) {
    parts.push(schedules.length === 1 ? 'Time driven' : `Time driven x${schedules.length}`);
  }
  if (events.length > 0) {
    const names = events.map((trigger) => trigger.event || 'any').slice(0, 2).join(', ');
    parts.push(events.length > 2 ? `Event driven x${events.length}: ${names}...` : `Event driven: ${names}`);
  }
  return parts.join(' · ');
};

const runtimeKey = (packId: string, agentId: string): string => `${packId}:${agentId}`;

const buildAgentConfigMap = (
  pack: agentpacks.InstalledPackSummary,
  overrides: Record<string, agentpacks.InstalledAgentConfig>
): Record<string, agentpacks.InstalledAgentConfig> => {
  const result: Record<string, agentpacks.InstalledAgentConfig> = {};
  for (const agent of pack.agents) {
    const key = runtimeKey(pack.pack_id, agent.id);
    result[agent.id] = overrides[key] ?? {
      enabled: agent.enabled,
      runtime: agent.runtime,
      triggers: agent.triggers ?? [],
    };
  }
  return result;
};

const modelOptionsForProvider = (
  provider: string,
  modelsByProvider: Record<string, ModelConfig[]>
): Array<{ id: string; label: string }> => {
  const providerModels = modelsByProvider[provider] ?? [];
  const fallbackModels = FALLBACK_MODELS[provider] ?? [];
  return providerModels.length > 0
    ? providerModels.map((model) => ({ id: model.model_id, label: model.display_name || model.model_id }))
    : fallbackModels.map((model) => ({ id: model, label: model }));
};

export const Agents: React.FC = () => {
  const { t } = useTranslation();
  const { createAgentTab } = useTabState();

  const [activeTab, setActiveTab] = useState('packs');
  const [packs, setPacks] = useState<agentpacks.InstalledPackSummary[]>([]);
  const [remotePacks, setRemotePacks] = useState<agentpacks.PackListing[]>([]);
  const [runningAgents, setRunningAgents] = useState<AgentRunWithMetrics[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderApiConfig[]>([]);
  const [runtimeDrafts, setRuntimeDrafts] = useState<Record<string, agentpacks.InstalledAgentConfig>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [runningAgentsLoading, setRunningAgentsLoading] = useState(false);
  const [runningAgentsLoaded, setRunningAgentsLoaded] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  useEffect(() => {
    void loadPacks();
    void loadRuntimeOptions();
  }, []);

  useEffect(() => {
    const cancel = deferUntilIdle(() => {
      void loadRunningAgents();
    }, 1500);
    return cancel;
  }, []);

  useProcessChanged(undefined, () => {
    void loadRunningAgents();
  });

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ModelConfig[]> = {};
    for (const model of models) {
      if (!model.is_enabled) continue;
      const provider = model.provider_id || model.provider_name || 'claude';
      grouped[provider] = [...(grouped[provider] ?? []), model];
    }
    return grouped;
  }, [models]);

  const apiConfigsByProvider = useMemo(() => {
    const grouped: Record<string, ProviderApiConfig[]> = {};
    for (const config of providerConfigs) {
      grouped[config.provider_id] = [...(grouped[config.provider_id] ?? []), config];
    }
    return grouped;
  }, [providerConfigs]);

  const loadRuntimeOptions = async () => {
    try {
      const [modelConfigs, apiConfigs] = await Promise.all([
        api.getEnabledModelConfigs?.() ?? api.getAllModelConfigs(),
        api.listProviderApiConfigs(),
      ]);
      setModels(modelConfigs ?? []);
      setProviderConfigs(apiConfigs ?? []);
    } catch (error) {
      console.error('Failed to load provider runtime options:', error);
      setToast({ message: 'Failed to load provider runtime options', type: 'error' });
    }
  };

  const loadPacks = async () => {
    try {
      setLoadingPacks(true);
      const installed = await api.listAgentPacks();
      setPacks(installed ?? []);
      setRuntimeDrafts((current) => {
        const next = { ...current };
        for (const pack of installed ?? []) {
          for (const agent of pack.agents) {
            const key = runtimeKey(pack.pack_id, agent.id);
            next[key] = next[key] ?? {
              enabled: agent.enabled,
              runtime: agent.runtime,
              triggers: agent.triggers ?? [],
            };
          }
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to load agent packs:', error);
      setToast({ message: 'Failed to load agent packs', type: 'error' });
    } finally {
      setLoadingPacks(false);
    }
  };

  const loadRemotePacks = async () => {
    try {
      setLoadingRemote(true);
      const index = await api.listRemoteAgentPacks({ type: 'github' });
      setRemotePacks(index?.packs ?? []);
    } catch (error) {
      console.error('Failed to load remote agent packs:', error);
      setToast({ message: 'Failed to load remote agent packs', type: 'error' });
    } finally {
      setLoadingRemote(false);
    }
  };

  const loadRunningAgents = async () => {
    try {
      setRunningAgentsLoading(true);
      const runs = await api.listAgentRunsWithMetrics();
      setRunningAgents(runs ?? []);
    } catch (error) {
      console.error('Failed to load running agents:', error);
      setRunningAgents([]);
    } finally {
      setRunningAgentsLoaded(true);
      setRunningAgentsLoading(false);
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'marketplace' && remotePacks.length === 0 && !loadingRemote) {
      void loadRemotePacks();
    }
    if (value === 'history' && !runningAgentsLoaded && !runningAgentsLoading) {
      void loadRunningAgents();
    }
  };

  const handleAgentCreated = (summary?: agentpacks.InstalledPackSummary) => {
    setShowCreateAgent(false);
    setActiveTab('packs');
    if (!summary) {
      void loadPacks();
      return;
    }
    setPacks((current) => {
      const next = current.filter((pack) => pack.pack_id !== summary.pack_id);
      return [...next, summary].sort((a, b) => a.name.localeCompare(b.name));
    });
    setRuntimeDrafts((current) => {
      const next = { ...current };
      for (const agent of summary.agents) {
        next[runtimeKey(summary.pack_id, agent.id)] = {
          enabled: agent.enabled,
          runtime: agent.runtime,
          triggers: agent.triggers ?? [],
        };
      }
      return next;
    });
    setToast({ message: `${summary.name} created`, type: 'success' });
  };

  const updateDraft = (
    pack: agentpacks.InstalledPackSummary,
    agent: agentpacks.AgentSummary,
    patch: AgentConfigPatch
  ) => {
    const key = runtimeKey(pack.pack_id, agent.id);
    setRuntimeDrafts((current) => {
      const base = current[key] ?? {
        enabled: agent.enabled,
        runtime: agent.runtime,
        triggers: agent.triggers ?? [],
      };
      return {
        ...current,
        [key]: {
          ...base,
          ...patch,
          runtime: {
            ...base.runtime,
            ...(patch.runtime ?? {}),
          },
        },
      };
    });
  };

  const saveAgentRuntime = async (pack: agentpacks.InstalledPackSummary, agent: agentpacks.AgentSummary) => {
    const key = runtimeKey(pack.pack_id, agent.id);
    const nextAgents = buildAgentConfigMap(pack, runtimeDrafts);
    setSavingKeys((current) => ({ ...current, [key]: true }));
    try {
      const updated = await api.saveAgentPackConfig(pack.pack_id, nextAgents);
      setPacks((current) => current.map((item) => item.pack_id === updated.pack_id ? updated : item));
      setRuntimeDrafts((current) => {
        const next = { ...current };
        for (const updatedAgent of updated.agents) {
          next[runtimeKey(updated.pack_id, updatedAgent.id)] = {
            enabled: updatedAgent.enabled,
            runtime: updatedAgent.runtime,
            triggers: updatedAgent.triggers ?? [],
          };
        }
        return next;
      });
      setToast({ message: `${agent.name} runtime saved`, type: 'success' });
    } catch (error) {
      console.error('Failed to save agent runtime:', error);
      setToast({ message: `Failed to save ${agent.name}`, type: 'error' });
    } finally {
      setSavingKeys((current) => ({ ...current, [key]: false }));
    }
  };

  const installRemotePack = async (listing: agentpacks.PackListing) => {
    try {
      await api.installAgentPack({
        source: {
          type: 'github',
          repo: 'RubinCarter/ropcode',
          ref: 'main',
          path: listing.path,
        },
      });
      setToast({ message: `${listing.name} installed`, type: 'success' });
      await loadPacks();
    } catch (error) {
      console.error('Failed to install remote pack:', error);
      setToast({ message: `Failed to install ${listing.name}`, type: 'error' });
    }
  };

  const installLocalPack = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: 'Select Agent Pack folder' });
      const path = selected?.filePaths?.[0];
      if (!path) return;
      await api.installLocalAgentPack(path, {}, false);
      setToast({ message: 'Agent pack installed', type: 'success' });
      await loadPacks();
    } catch (error) {
      console.error('Failed to install local pack:', error);
      setToast({ message: 'Failed to install local pack', type: 'error' });
    }
  };

  const updatePack = async (pack: agentpacks.InstalledPackSummary) => {
    try {
      const result = await api.updateAgentPack(pack.pack_id);
      if (result.updated) {
        setToast({ message: `${pack.name} updated to ${result.new_version}`, type: 'success' });
      } else {
        setToast({ message: `${pack.name} is already up to date`, type: 'success' });
      }
      await loadPacks();
    } catch (error) {
      console.error('Failed to update pack:', error);
      setToast({ message: `Failed to update ${pack.name}`, type: 'error' });
    }
  };

  const checkPackUpdate = async (pack: agentpacks.InstalledPackSummary) => {
    try {
      const checked = await api.checkAgentPackUpdate(pack.pack_id);
      setPacks((current) => current.map((item) => item.pack_id === checked.pack_id ? checked : item));
      setToast({
        message: checked.update_available ? `${pack.name} ${checked.latest_version} is available` : `${pack.name} is up to date`,
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to check pack update:', error);
      setToast({ message: `Failed to check ${pack.name}`, type: 'error' });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const renderRuntimeControls = (pack: agentpacks.InstalledPackSummary, agent: agentpacks.AgentSummary) => {
    const key = runtimeKey(pack.pack_id, agent.id);
    const draft = runtimeDrafts[key] ?? {
      enabled: agent.enabled,
      runtime: agent.runtime,
      triggers: agent.triggers ?? [],
    };
    const selectedProvider = draft.runtime.provider || 'claude';
    const modelOptions = modelOptionsForProvider(selectedProvider, modelsByProvider);
    const apiOptions = apiConfigsByProvider[selectedProvider] ?? [];
    const isSaving = !!savingKeys[key];

    return (
      <div className="mt-4 rounded-md border bg-muted/15 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Runtime
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`${key}-enabled`} className="text-xs text-muted-foreground">Enabled</Label>
            <Switch
              id={`${key}-enabled`}
              checked={draft.enabled}
              onCheckedChange={(enabled) => updateDraft(pack, agent, { enabled })}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <Select
              value={selectedProvider}
              onValueChange={(provider) => {
                const model = (modelsByProvider[provider]?.[0]?.model_id) || FALLBACK_MODELS[provider]?.[0] || '';
                updateDraft(pack, agent, {
                  runtime: {
                    provider,
                    model,
                    provider_api_id: '',
                  },
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <Select
              value={draft.runtime.model || modelOptions[0]?.id || ''}
              onValueChange={(model) => updateDraft(pack, agent, { runtime: { model } })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">API</Label>
            <Select
              value={draft.runtime.provider_api_id || 'default'}
              onValueChange={(providerApiId) => updateDraft(pack, agent, {
                runtime: { provider_api_id: providerApiId === 'default' ? '' : providerApiId },
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                {apiOptions.filter((config) => !!config.id).map((config) => (
                  <SelectItem key={config.id} value={config.id || 'default'}>
                    {config.name}{config.is_default ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{providerLabel(selectedProvider)} · {draft.runtime.model || 'model not selected'}</span>
          <Button size="sm" variant="outline" onClick={() => saveAgentRuntime(pack, agent)} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>
    );
  };

  if (showCreateAgent) {
    return (
      <CreateAgent
        onBack={() => setShowCreateAgent(false)}
        onAgentCreated={handleAgentCreated}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex h-full max-w-7xl flex-col">
        <div className="border-b p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('agents.title')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('agents.subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setShowCreateAgent(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Agent
              </Button>
              <Button variant="outline" onClick={installLocalPack}>
                <FolderInput className="mr-2 h-4 w-4" />
                Install Local
              </Button>
              <Button variant="outline" onClick={loadRemotePacks} disabled={loadingRemote}>
                {loadingRemote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                Refresh Catalog
              </Button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-6 mt-4"
            >
              <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-6">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mb-6 grid h-auto w-full max-w-xl grid-cols-3 p-1">
              <TabsTrigger value="packs" className="py-2.5">
                <PackageOpen className="mr-2 h-4 w-4" />
                Installed {packs.length ? `(${packs.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="py-2.5">
                <Download className="mr-2 h-4 w-4" />
                Catalog {remotePacks.length ? `(${remotePacks.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="history" className="py-2.5">
                <History className="mr-2 h-4 w-4" />
                History {runningAgentsLoaded ? `(${runningAgents.length})` : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="packs" className="space-y-4">
              {loadingPacks ? (
                <Card className="p-8">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading agent packs</span>
                  </div>
                </Card>
              ) : packs.length === 0 ? (
                <Card className="p-10">
                  <div className="mx-auto flex max-w-md flex-col items-center text-center">
                    <FileArchive className="mb-4 h-10 w-10 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">No agent packs installed</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Install from the online catalog or choose a local pack folder from this machine.
                    </p>
                    <div className="mt-5 flex gap-2">
                      <Button onClick={() => setShowCreateAgent(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Agent
                      </Button>
                      <Button onClick={() => handleTabChange('marketplace')}>
                        <Globe className="mr-2 h-4 w-4" />
                        Browse Catalog
                      </Button>
                      <Button variant="outline" onClick={installLocalPack}>
                        <FolderInput className="mr-2 h-4 w-4" />
                        Local Folder
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <div className="space-y-4">
                  {packs.map((pack) => (
                    <Card key={pack.pack_id} className="p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold">{pack.name}</h2>
                            <Badge variant="secondary">v{pack.installed_version}</Badge>
                            {pack.update_available && <Badge>Update {pack.latest_version}</Badge>}
                          </div>
                          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{pack.description || pack.pack_id}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />{pack.source.type}</span>
                            <span className="truncate">{pack.source.repo || pack.source.path}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button variant="outline" size="sm" onClick={() => checkPackUpdate(pack)}>
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                            Check
                          </Button>
                          <Button size="sm" onClick={() => updatePack(pack)} disabled={pack.source.type !== 'github'}>
                            <Download className="mr-2 h-3.5 w-3.5" />
                            Update
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {pack.agents.map((agent) => {
                          const draft = runtimeDrafts[runtimeKey(pack.pack_id, agent.id)];
                          return (
                            <div key={agent.id} className="rounded-md border p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Bot className="h-4 w-4 text-primary" />
                                    <h3 className="font-medium">{agent.name}</h3>
                                    <Badge variant={draft?.enabled ? 'default' : 'outline'} className="text-xs">
                                      {draft?.enabled ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1"><Server className="h-3.5 w-3.5" />{providerLabel(draft?.runtime.provider || agent.runtime.provider || 'claude')}</span>
                                    <span>{draft?.runtime.model || agent.runtime.model}</span>
                                    <span>{triggerSummary(draft?.triggers ?? agent.triggers)}</span>
                                  </div>
                                </div>
                              </div>
                              {renderRuntimeControls(pack, agent)}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="marketplace" className="space-y-4">
              {loadingRemote ? (
                <Card className="p-8">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading catalog</span>
                  </div>
                </Card>
              ) : remotePacks.length === 0 ? (
                <Card className="p-10">
                  <div className="mx-auto flex max-w-md flex-col items-center text-center">
                    <Sparkles className="mb-4 h-10 w-10 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Online catalog</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Load the catalog from the Ropcode GitHub repository.
                    </p>
                    <Button className="mt-5" onClick={loadRemotePacks}>
                      <Globe className="mr-2 h-4 w-4" />
                      Load Catalog
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {remotePacks.map((listing) => {
                    const installed = packs.some((pack) => pack.pack_id === listing.id);
                    return (
                      <Card key={listing.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold">{listing.name}</h3>
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{listing.description || listing.id}</p>
                          </div>
                          <Badge variant="secondary">v{listing.version}</Badge>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="truncate text-xs text-muted-foreground">{listing.path}</span>
                          <Button size="sm" onClick={() => installRemotePack(listing)} disabled={installed}>
                            <Download className="mr-2 h-3.5 w-3.5" />
                            {installed ? 'Installed' : 'Install'}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-6">
              {runningAgentsLoading && !runningAgentsLoaded ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : runningAgents.length === 0 ? (
                <Card className="p-12">
                  <div className="flex flex-col items-center justify-center text-center">
                    <History className="mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">No agent runs</h3>
                    <p className="text-muted-foreground">Completed and running agent executions will appear here.</p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-4">
                  {runningAgents.map((run) => (
                    <Card key={run.id} className="p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(run.status)}
                          <h3 className="font-semibold">{run.agent_name}</h3>
                          <Badge variant="outline" className="text-xs">{run.status}</Badge>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => createAgentTab(run.id?.toString() || '', run.agent_name, run.project_path)}
                          className="h-8 w-8"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4 text-sm md:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">Started:</span>
                          <p className="font-medium">{new Date(run.created_at).toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Duration:</span>
                          <p className="font-medium">{run.metrics?.duration_ms ? `${(run.metrics.duration_ms / 1000).toFixed(1)}s` : run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tokens:</span>
                          <p className="font-medium">{run.metrics?.total_tokens ? run.metrics.total_tokens.toLocaleString() : run.total_tokens ? run.total_tokens.toLocaleString() : '-'}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Agents;
