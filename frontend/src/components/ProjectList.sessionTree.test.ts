import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectListPath = path.resolve(currentDir, './ProjectList.tsx');
const rpcClientPath = path.resolve(currentDir, '../lib/rpc-client.ts');

async function readSource(filePath: string) {
  return fs.readFile(filePath, 'utf8');
}

test('ProjectList lazily loads mixed space sessions and opens historical chat tabs', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /api\.listSpaceSessions\(spacePath,\s*10\)/);
  assert.match(source, /api\.listSpaceSessions\(spacePath,\s*0\)/);
  assert.match(source, /openSessionTab/);
  assert.match(source, /session\.provider/);
  assert.match(source, /session\.last_activity/);
  assert.match(source, /More/);
});

test('ProjectList exposes tree-only mode for desktop companion sidebar', async () => {
  const projectListSource = await readSource(projectListPath);
  const sidebarSource = await readSource(path.resolve(currentDir, './Sidebar.tsx'));

  assert.match(projectListSource, /showInlineSessions\?: boolean/);
  assert.match(projectListSource, /showInlineSessions\s*=\s*true/);
  assert.match(projectListSource, /onSelectedSpaceChange\?:/);
  assert.match(sidebarSource, /showInlineSessions=\{false\}/);
});

test('Sidebar project lists refresh from project changed events', async () => {
  const sidebarSource = await readSource(path.resolve(currentDir, './Sidebar.tsx'));
  const mobileSource = await readSource(path.resolve(currentDir, './mobile/MobileLayout.tsx'));
  const syncBridgeSource = await readSource(path.resolve(currentDir, './SyncEventsBridge.tsx'));

  assert.match(sidebarSource, /EventsOn\('project:changed'/);
  assert.match(sidebarSource, /window\.addEventListener\('project:changed'/);
  assert.match(sidebarSource, /loadProjects\(\)/);
  assert.match(mobileSource, /EventsOn\('project:changed'/);
  assert.match(mobileSource, /window\.addEventListener\('project:changed'/);
  assert.match(mobileSource, /loadProjects\(\)/);
  assert.match(syncBridgeSource, /useSyncEvents/);
  assert.match(syncBridgeSource, /new CustomEvent\('project:changed'/);
  assert.match(syncBridgeSource, /ropcode-space-sessions-refresh/);
});

test('ProjectList does not fan out session scans to all child workspaces when expanding a project', async () => {
  const source = await readSource(projectListPath);

  assert.doesNotMatch(source, /project\?\.workspaces\?\.forEach\(workspace => \{\s*const provider = getWorkspaceProvider\(workspace\);\s*if \(provider\?\.path\) \{\s*ensureSpaceSessionsLoaded\(provider\.path\);/s);
});

test('ProjectList exposes explicit new session buttons for project and workspace spaces', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /MessageSquarePlus/);
  assert.match(source, /openNewSessionTab/);
  assert.match(source, /new CustomEvent\('open-new-session'/);
  assert.match(source, /title="New session"/);
  assert.match(source, /aria-label=\{`New session in \$\{getProjectName\(project\.path\)\}`\}/);
  assert.match(source, /aria-label=\{`New session in \$\{workspaceBranches\[claudeProvider\.path\] \|\| workspace\.branch \|\| workspace\.name\}`\}/);
});

test('ProjectList refreshes loaded space sessions when a chat turn completes', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /window\.addEventListener\('ropcode-space-sessions-refresh'/);
  assert.match(source, /loadSpaceSessions\(spacePath,\s*prev\[spacePath\]\?\.loadedAll \? 0 : 10\)/);
});

test('ProjectList renders provider icons instead of provider text labels in session rows', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /getProviderIcon/);
  assert.match(source, /DeepSeekIcon/);
  assert.match(source, /provider === 'deepseek'\) return DeepSeekIcon/);
  assert.doesNotMatch(source, /<span className="flex-shrink-0 font-medium">\{getProviderLabel\(session\.provider\)\}<\/span>/);
});

test('ProjectList tracks running live sessions by workspace and session id', async () => {
  const source = await readSource(projectListPath);
  const sidebarSource = await readSource(path.resolve(currentDir, './sidebar/useSpaceSessions.ts'));

  assert.match(source, /listRunningProviderSessions/);
  assert.match(source, /runningSessionIds/);
  assert.match(source, /session\.is_running \|\| runningSessionIds\.has\(`\$\{session\.provider\}:\$\{session\.id\}`\)/);
  assert.match(source, /session\.provider_session_id/);
  assert.match(sidebarSource, /session\.provider_session_id/);
});

test('WorkspaceContainer handles explicit new session events with a blank chat tab', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /type OpenNewSessionEvent = CustomEvent/);
  assert.match(source, /const pendingNewSession = \(window as any\)\.__ROPCODE_PENDING_NEW_SESSION__/);
  assert.match(source, /pendingNewSession\?\.spacePath === workspaceId/);
  assert.match(source, /window\.addEventListener\('open-new-session'/);
  assert.match(source, /skipSessionRestore: true/);
  assert.match(source, /sessionId: undefined/);
  assert.match(source, /sessionData: undefined/);
});

test('WorkspaceContainer keeps explicit new sessions blank when switching providers', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /tab\.skipSessionRestore/);
  assert.match(source, /Keep explicit new sessions blank when switching providers/);
  assert.match(source, /providerId,\s*sessionData: undefined,\s*sessionId: undefined,\s*providerSessions: currentProviderSessions/s);
  assert.match(source, /return;\s*\}\s*\/\/ Get the actual project path/s);
});

test('WorkspaceContainer deduplicates explicit new session tabs', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /skipSessionRestore === true/);
  assert.match(source, /setActiveTab\(existingNewSessionTab\.id\)/);
});

test('WorkspaceContainer reuses the initial blank chat tab for explicit new sessions', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /tabsRef/);
  assert.match(source, /existingBlankChatTab/);
  assert.match(source, /title: 'New chat'/);
  assert.match(source, /skipSessionRestore: true/);
  assert.match(source, /setActiveTab\(existingBlankChatTab\.id\)/);
  assert.match(source, /updateTab\(existingBlankChatTab\.id,/);
  assert.match(source, /Skipping background session restore for explicit new tab/);
});

test('WorkspaceContainer replaces the active chat tab for explicit new sessions', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /lastHandledNewSessionRef/);
  assert.match(source, /newSessionKey/);
  assert.match(source, /replacementTab/);
  assert.match(source, /sessionId: undefined/);
  assert.match(source, /sessionData: undefined/);
  assert.match(source, /sessionResetNonce/);
  assert.match(source, /key=\{`\$\{tab\.id\}-\$\{tab\.providerId \|\| 'claude'\}-\$\{tab\.sessionResetNonce \?\? 0\}`\}/);
});

test('WorkspaceContainer creates pending new sessions during initialization', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /delete \(window as any\)\.__ROPCODE_PENDING_NEW_SESSION__/);
  assert.match(source, /title: 'New chat'/);
  assert.match(source, /skipSessionRestore: true/);
  assert.match(source, /sessionResetNonce: 1/);
  assert.match(source, /return;\s*\}\s*\n\s*const pending = \(window as any\)\.__ROPCODE_PENDING_PROVIDER_SESSION__/s);
  assert.doesNotMatch(source, /closeOtherChatTabs/);
});

test('WorkspaceContainer updates chat runtime state by owning tab id', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /onStreamingChange=\{\(isStreaming,\s*sessionId\) => handleStreamingChange\(tab\.id,\s*isStreaming,\s*sessionId\)\}/);
  assert.match(source, /onProcessAliveChange=\{\(isAlive\) => handleProcessAliveChange\(tab\.id,\s*isAlive\)\}/);
  assert.doesNotMatch(source, /const tabId = activeTabIdRef\.current;\s*if \(tabId\) \{\s*updateTab\(tabId,\s*\{\s*status: isStreaming/s);
});

test('WorkspaceTabManager does not show chat session liveness badges in tabs', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceTabManager.tsx'));

  assert.doesNotMatch(source, /Session idle/);
  assert.doesNotMatch(source, /Session closed/);
});

test('ProjectList deduplicates historical workspace chat tabs by projectPath', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /tab\.projectPath === spacePath/);
  assert.doesNotMatch(source, /tab\.initialProjectPath === spacePath/);
});

test('AiCodeSession can skip automatic session restoration for explicit new tabs', async () => {
  const source = await readSource(path.resolve(currentDir, './ai-code-session/SessionController.tsx'));
  const lifecycleSource = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionControllerLifecycle.ts'));
  const types = await readSource(path.resolve(currentDir, './ai-code-session/types.ts'));

  assert.match(types, /skipSessionRestore\?: boolean/);
  assert.match(source, /skipSessionRestore = false/);
  assert.match(lifecycleSource, /if \(skipSessionRestore\) \{/);
  assert.match(lifecycleSource, /Skipping session restore for explicit new session/);
});

test('AiCodeSession does not auto-restore localStorage over an explicit historical session', async () => {
  const source = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionControllerLifecycle.ts'));

  assert.match(source, /Skipping session restore for explicit historical session/);
  assert.match(source, /if \(session\) \{/);
});

test('AiCodeSession checks running state with the active session id, not provider id', async () => {
  const source = await readSource(path.resolve(currentDir, './ai-code-session/hooks/useSessionRecovery.ts'));

  assert.match(source, /isClaudeSessionRunningForProject\(projectPath,\s*sessionId\)/);
  assert.doesNotMatch(source, /isClaudeSessionRunningForProject\(projectPath,\s*defaultProvider\)/);
});

test('rpc client exposes ListSpaceSessions result types and wrapper', async () => {
  const source = await readSource(rpcClientPath);

  assert.match(source, /interface ProviderSessionSummary/);
  assert.match(source, /interface SpaceSessionsResult/);
  assert.match(source, /function ListSpaceSessions\(projectPath: string, limit: number\)/);
  assert.match(source, /wsClient\.call\('ListSpaceSessions', projectPath, limit\)/);
});

test('rpc client names provider history argument as projectId', async () => {
  const source = await readSource(rpcClientPath);
  const providersSource = await readSource(path.resolve(currentDir, '../lib/providers.ts'));

  assert.match(source, /function LoadProviderSessionHistory\(\s*projectId: string,\s*sessionId: string,/);
  assert.match(source, /wsClient\.call\('LoadProviderSessionHistory', sessionId, projectId, providerName\)/);
  assert.match(providersSource, /loadHistory: async \(sessionId: string, projectId: string, providerName: string\)/);
});
