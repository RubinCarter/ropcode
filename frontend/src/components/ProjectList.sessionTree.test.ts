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
  assert.doesNotMatch(source, /<span className="flex-shrink-0 font-medium">\{getProviderLabel\(session\.provider\)\}<\/span>/);
});

test('ProjectList tracks running live sessions by workspace and session id', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /listRunningProviderSessions/);
  assert.match(source, /runningSessionIds/);
  assert.match(source, /session\.is_running \|\| runningSessionIds\.has\(`\$\{session\.provider\}:\$\{session\.id\}`\)/);
});

test('WorkspaceContainer handles explicit new session events with a blank chat tab', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /type OpenNewSessionEvent = CustomEvent/);
  assert.match(source, /window\.addEventListener\('open-new-session'/);
  assert.match(source, /skipSessionRestore: true/);
  assert.match(source, /sessionId: undefined/);
  assert.match(source, /sessionData: undefined/);
});

test('WorkspaceContainer deduplicates explicit new session tabs', async () => {
  const source = await readSource(path.resolve(currentDir, './containers/WorkspaceContainer.tsx'));

  assert.match(source, /skipSessionRestore === true/);
  assert.match(source, /setActiveTab\(existingNewSessionTab\.id\)/);
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

test('AiCodeSession can skip automatic session restoration for explicit new tabs', async () => {
  const source = await readSource(path.resolve(currentDir, './ai-code-session/AiCodeSession.tsx'));
  const types = await readSource(path.resolve(currentDir, './ai-code-session/types.ts'));

  assert.match(types, /skipSessionRestore\?: boolean/);
  assert.match(source, /skipSessionRestore = false/);
  assert.match(source, /if \(skipSessionRestore\) \{/);
  assert.match(source, /Skipping session restore for explicit new session/);
});

test('rpc client exposes ListSpaceSessions result types and wrapper', async () => {
  const source = await readSource(rpcClientPath);

  assert.match(source, /interface ProviderSessionSummary/);
  assert.match(source, /interface SpaceSessionsResult/);
  assert.match(source, /function ListSpaceSessions\(projectPath: string, limit: number\)/);
  assert.match(source, /wsClient\.call\('ListSpaceSessions', projectPath, limit\)/);
});
