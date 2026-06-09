import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const lazyModulesPath = path.resolve(currentDir, './lazyModules.ts');
const appPath = path.resolve(currentDir, '../App.tsx');
const viteConfigPath = path.resolve(currentDir, '../../vite.config.ts');

test('App does not preload lazy chunks from the renderer at startup', async () => {
  const source = await fs.readFile(appPath, 'utf8');

  assert.doesNotMatch(source, /preloadStartupLazyModules/);
});

test('lazy module registry does not memoize startup preload work', async () => {
  const source = await fs.readFile(lazyModulesPath, 'utf8');

  assert.doesNotMatch(source, /requestIdleCallback/);
  assert.doesNotMatch(source, /setTimeout/);
  assert.doesNotMatch(source, /startupLazyLoaders/);
  assert.doesNotMatch(source, /preloadStartupLazyModules/);
});

test('lazy module registry is limited to heavy or nested views', async () => {
  const source = await fs.readFile(lazyModulesPath, 'utf8');

  for (const removedSystemLoader of [
    'loadAgents',
    'loadSettings',
    'loadUsageDashboard',
    'loadMCPManager',
    'loadMarkdownEditor',
    'loadCreateAgent',
    'loadClaudeVersionSelector',
    'loadDebugLogs',
    'loadStorageTab',
    'loadHooksEditor',
    'loadSlashCommandsManager',
    'loadProxySettings',
    'loadProviderApiManager',
    'loadClaudeAgentsManager',
    'loadPluginsManager',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${removedSystemLoader}\\b`));
  }

  for (const loaderName of [
    'loadAiCodeSession',
    'loadAgentRunOutputViewer',
    'loadAgentExecution',
    'loadDiffViewer',
    'loadFileViewer',
    'loadWebViewWidget',
    'loadGitHubAgentBrowser',
  ]) {
    assert.match(source, new RegExp(`\\b${loaderName}\\b`));
  }
});

test('Vite dev server warmup handles startup transforms outside React runtime', async () => {
  const source = await fs.readFile(viteConfigPath, 'utf8');

  assert.match(source, /warmup:\s*\{/);
  assert.match(source, /clientFiles:\s*\[/);
  assert.match(source, /src\/components\/Agents\.tsx/);
  assert.match(source, /src\/components\/Settings\.tsx/);
});
