type DefaultModule<T> = { default: T };
type LazyLoader<T> = () => Promise<DefaultModule<T>>;

const memoizeLazy = <T>(loader: () => Promise<T>): (() => Promise<T>) => {
  let promise: Promise<T> | null = null;

  return () => {
    if (!promise) {
      promise = loader().catch((error) => {
        promise = null;
        throw error;
      });
    }

    return promise;
  };
};

const withDefaultExport = <TModule, TComponent>(
  loader: () => Promise<TModule>,
  select: (module: TModule) => TComponent,
): LazyLoader<TComponent> => memoizeLazy(() => loader().then((module) => ({ default: select(module) })));

export const loadAiCodeSession = withDefaultExport(
  () => import('@/components/ai-code-session'),
  (module) => module.AiCodeSession,
);

export const loadAgentRunOutputViewer = withDefaultExport(
  () => import('@/components/AgentRunOutputViewer'),
  (module) => module.AgentRunOutputViewer,
);

export const loadAgentExecution = withDefaultExport(
  () => import('@/components/AgentExecution'),
  (module) => module.AgentExecution,
);

export const loadDiffViewer = withDefaultExport(
  () => import('@/components/right-sidebar/DiffViewer'),
  (module) => module.DiffViewer,
);

export const loadFileViewer = withDefaultExport(
  () => import('@/components/FileViewer'),
  (module) => module.FileViewer,
);

export const loadWebViewWidget = withDefaultExport(
  () => import('@/components/WebViewWidget'),
  (module) => module.WebViewWidget,
);

export const loadGitHubAgentBrowser = withDefaultExport(
  () => import('@/components/GitHubAgentBrowser'),
  (module) => module.GitHubAgentBrowser,
);

export const loadStorageTab = withDefaultExport(
  () => import('@/components/StorageTab'),
  (module) => module.StorageTab,
);

export const loadHooksEditor = withDefaultExport(
  () => import('@/components/HooksEditor'),
  (module) => module.HooksEditor,
);

export const loadSlashCommandsManager = withDefaultExport(
  () => import('@/components/SlashCommandsManager'),
  (module) => module.SlashCommandsManager,
);

export const loadProxySettings = withDefaultExport(
  () => import('@/components/ProxySettings'),
  (module) => module.ProxySettings,
);

export const loadProviderApiManager = withDefaultExport(
  () => import('@/components/ProviderApiManager'),
  (module) => module.ProviderApiManager,
);

export const loadClaudeAgentsManager = withDefaultExport(
  () => import('@/components/ClaudeAgentsManager'),
  (module) => module.ClaudeAgentsManager,
);

export const loadPluginsManager = withDefaultExport(
  () => import('@/components/PluginsManager'),
  (module) => module.PluginsManager,
);
