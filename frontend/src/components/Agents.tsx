import React, { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Loader2, Play, Clock, CheckCircle, XCircle, Trash2, Import, ChevronDown, ChevronRight, FileJson, Globe, Download, Plus, History, Edit } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
import { api, type Agent, type AgentRunWithMetrics } from '@/lib/api';
import { open as openDialog, save } from '@/lib/dialog';
import { useTabState } from '@/hooks/useTabState';
import { useProcessChanged } from '@/hooks';
import { useTranslation } from 'react-i18next';
// Note: ExportAgentToFile uses api.exportAgentToFile

const GitHubAgentBrowser = lazy(() =>
  import('@/components/GitHubAgentBrowser').then((m) => ({ default: m.GitHubAgentBrowser })),
);
const CreateAgent = lazy(() =>
  import('@/components/CreateAgent').then((m) => ({ default: m.CreateAgent })),
);

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

export const Agents: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('agents');
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runningAgents, setRunningAgents] = useState<AgentRunWithMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [runningAgentsLoading, setRunningAgentsLoading] = useState(false);
  const [runningAgentsLoaded, setRunningAgentsLoaded] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showGitHubBrowser, setShowGitHubBrowser] = useState(false);
  const { createAgentTab } = useTabState();

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    const cancel = deferUntilIdle(() => {
      loadRunningAgents();
    }, 1500);

    return cancel;
  }, []);

  // Subscribe to process change events to update agent list
  useProcessChanged(undefined, (event) => {
    loadRunningAgents();
  });

  const loadAgents = async () => {
    try {
      setLoading(true);
      const agents = await api.listAgents();
      setAgents(agents);
    } catch (error) {
      console.error('Failed to load agents:', error);
      setToast({ message: t('agents.failedToLoadAgents'), type: 'error' });
    } finally {
      setAgentsLoaded(true);
      setLoading(false);
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
    if (value === 'running' && !runningAgentsLoaded && !runningAgentsLoading) {
      loadRunningAgents();
    }
  };

  const handleRunAgent = async (agent: Agent) => {
    if (!agent.id) {
      setToast({ message: t('agents.agentIdMissing'), type: 'error' });
      return;
    }
    
    // Import the dialog function
    const { open } = await import('@/lib/dialog');
    
    try {
      // Prompt user to select a project directory
      const projectPath = await open({
        directory: true,
        multiple: false,
        title: t('agents.selectProjectDir', { name: agent.name })
      });
      
      if (!projectPath) {
        // User cancelled
        return;
      }
      
      // Dispatch event to open agent execution in a new tab
      const tabId = `agent-exec-${agent.id}-${Date.now()}`;
      window.dispatchEvent(new CustomEvent('open-agent-execution', { 
        detail: { agent, tabId, projectPath } 
      }));
      
      setToast({ message: t('agents.openingAgent', { name: agent.name }), type: 'success' });
    } catch (error) {
      console.error('Failed to open agent:', error);
      setToast({ message: t('agents.failedToOpenAgent', { name: agent.name }), type: 'error' });
    }
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete || !agentToDelete.id) return;
    
    try {
      await api.deleteAgent(agentToDelete.id);
      setToast({ message: t('agents.deletedAgent', { name: agentToDelete.name }), type: 'success' });
      setAgents(prev => prev.filter(a => a.id !== agentToDelete.id));
      setShowDeleteDialog(false);
      setAgentToDelete(null);
    } catch (error) {
      console.error('Failed to delete agent:', error);
      setToast({ message: t('agents.failedToDeleteAgent', { name: agentToDelete.name }), type: 'error' });
    }
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await openDialog({
        filters: [
          { name: 'Ropcode Agent', extensions: ['ropcode.json', 'json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        multiple: false,
      });

      if (selected && !selected.canceled && selected.filePaths && selected.filePaths[0]) {
        const importedAgent = await api.importAgentFromFile(selected.filePaths[0]);
        setToast({ message: t('agents.importedAgent', { name: importedAgent.name }), type: 'success' });
        loadAgents();
      }
    } catch (error) {
      console.error('Failed to import agent:', error);
      setToast({ message: t('agents.failedToImportAgent'), type: 'error' });
    }
  };

  const handleExportAgent = async (agent: Agent) => {
    try {
      const result = await save({
        defaultPath: `${agent.name.toLowerCase().replace(/\s+/g, '-')}.ropcode.json`,
        filters: [
          { name: 'Ropcode Agent', extensions: ['ropcode.json'] }
        ]
      });

      if (result && !result.canceled && result.filePath && agent.id) {
        await api.exportAgentToFile(agent.id, result.filePath);
        setToast({ message: t('agents.exportedAgent', { name: agent.name }), type: 'success' });
      }
    } catch (error) {
      console.error('Failed to export agent:', error);
      setToast({ message: t('agents.failedToExportAgent'), type: 'error' });
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

  // Show CreateAgent component if creating
  if (showCreateAgent) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
        <CreateAgent
          onBack={() => setShowCreateAgent(false)}
          onAgentCreated={() => {
            setShowCreateAgent(false);
            loadAgents(); // Reload agents after creation
          }}
        />
      </Suspense>
    );
  }

  // Show CreateAgent component in edit mode
  if (editingAgent) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
        <CreateAgent
          agent={editingAgent}
          onBack={() => setEditingAgent(null)}
          onAgentCreated={() => {
            setEditingAgent(null);
            loadAgents(); // Reload agents after update
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto flex flex-col h-full">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t('agents.title')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('agents.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Import className="w-4 h-4 mr-2" />
                    Import
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleImportFromFile}>
                    <FileJson className="w-4 h-4 mr-2" />
                    {t('agents.importFromFile')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowGitHubBrowser(true)}>
                    <Globe className="w-4 h-4 mr-2" />
                    {t('agents.importFromGithub')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button onClick={() => setShowCreateAgent(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('agents.createAgent')}
              </Button>
            </div>
          </div>
        </div>

        {/* Toast notifications */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-6 mb-4"
            >
              <Toast 
                message={toast.message} 
                type={toast.type}
                onDismiss={() => setToast(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>

      {showGitHubBrowser && (
        <Suspense fallback={null}>
          <GitHubAgentBrowser
            isOpen={showGitHubBrowser}
            onClose={() => setShowGitHubBrowser(false)}
            onImportSuccess={() => {
              loadAgents();
              setShowGitHubBrowser(false);
              setToast({ message: t('agents.importedAgent', { name: '' }).replace(': ', ''), type: 'success' });
            }}
          />
        </Suspense>
      )}

      <AnimatePresence>
        {showDeleteDialog && agentToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={() => setShowDeleteDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card p-6 rounded-lg shadow-lg max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold mb-4">{t('agents.deleteAgent')}</h3>
              <p className="text-muted-foreground mb-6">
                {t('agents.deleteAgentConfirm')}
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteDialog(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAgent}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid grid-cols-2 w-full max-w-md mb-6 h-auto p-1">
              <TabsTrigger value="agents" className="py-2.5 px-3">
                <Bot className="w-4 h-4 mr-2" />
                {t('agents.tabAgents')} {agentsLoaded ? `(${agents.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="running" className="py-2.5 px-3">
                <History className="w-4 h-4 mr-2" />
                {t('agents.tabHistory')} {runningAgentsLoaded ? `(${runningAgents.length})` : ""}
              </TabsTrigger>
            </TabsList>

          <TabsContent value="agents" className="flex-1 overflow-hidden">
              {!agentsLoaded ? (
                <Card className="p-8">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t('common.loading')}</span>
                  </div>
                </Card>
              ) : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Bot className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{t('agents.noAgents')}</h3>
                  <p className="text-muted-foreground mb-4">
                    {t('agents.noAgentsDesc')}
                  </p>
                  <Button onClick={() => setShowCreateAgent(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {t('agents.createAgent')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('common.loading')}</span>
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {agents.map((agent) => (
                    <Card
                      key={agent.id}
                      className="p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Bot className="w-5 h-5 text-primary" />
                          <h3 className="font-semibold">{agent.name}</h3>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ChevronDown className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditingAgent(agent)}>
                              <Edit className="w-4 h-4 mr-2" />
                              {t('common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRunAgent(agent)}>
                              <Play className="w-4 h-4 mr-2" />
                              {t('agents.runAgent')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExportAgent(agent)}>
                              <Download className="w-4 h-4 mr-2" />
                              {t('agents.exportAgent')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setAgentToDelete(agent);
                                setShowDeleteDialog(true);
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {t('agents.deleteAgent')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                        No description provided
                      </p>

                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-xs">
                          v1.0.0
                        </Badge>
                        <Button
                          size="sm"
                          onClick={() => handleRunAgent(agent)}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          {t('agents.runAgent')}
                        </Button>
                      </div>
                    </Card>
                  ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="running" className="space-y-6 mt-6">
              {runningAgentsLoading && !runningAgentsLoaded ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : runningAgents.length === 0 ? (
                <Card className="p-12">
                  <div className="flex flex-col items-center justify-center text-center">
                    <History className="w-12 h-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">{t('agents.noAgents')}</h3>
                    <p className="text-muted-foreground">
                      {t('agents.tabRunning')}
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-4">
                  {runningAgents.map((run) => (
                    <Card
                      key={run.id}
                      className="p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(run.status)}
                          <h3 className="font-semibold">{run.agent_name}</h3>
                          <Badge variant="outline" className="text-xs">
                            {run.status}
                          </Badge>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => createAgentTab(run.id?.toString() || '', run.agent_name, run.project_path)}
                          className="h-8 w-8"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Started:</span>
                          <p className="font-medium">{new Date(run.created_at).toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Duration:</span>
                          <p className="font-medium">{run.metrics?.duration_ms ? `${(run.metrics.duration_ms / 1000).toFixed(1)}s` : run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tokens:</span>
                          <p className="font-medium">{run.metrics?.total_tokens ? run.metrics.total_tokens.toLocaleString() : run.total_tokens ? run.total_tokens.toLocaleString() : '—'}</p>
                        </div>
                      </div>

                      {run.status === 'failed' && (
                        <div className="mt-3 p-2 bg-destructive/10 rounded text-sm text-destructive">
                          Agent execution failed
                        </div>
                      )}
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
