import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('WorkspaceContainer does not clear ProjectChat frames when switching providers', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './WorkspaceContainer.tsx'), 'utf8');

  assert.doesNotMatch(source, /clearSessionFrames\(tab\.projectChatId\)/);
});

test('WorkspaceContainer keeps ProjectChat id stable during background session restore', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './WorkspaceContainer.tsx'), 'utf8');

  assert.doesNotMatch(source, /CreateProjectChat/);
  assert.doesNotMatch(source, /const selectedProjectChat = await ensureProjectChatForTabSession/);
  assert.match(source, /const restoredProjectChat = await ensureProjectChatForHistoricalSession\(workspaceId, selectedSession\);/);
  assert.match(source, /let nextProjectChatId = restoredProjectChat\.chat\.chat_id;/);
  assert.match(source, /SwitchProjectChatProvider\(\s*restoredProjectChat\.chat\.chat_id,/);
  assert.match(source, /projectChatId: nextProjectChatId,/);
  assert.match(source, /allowProjectChatRebind: true,/);
});

test('WorkspaceContainer asks backend to ensure ProjectChat ownership', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './WorkspaceContainer.tsx'), 'utf8');
  const rpcSource = await fs.readFile(path.resolve(currentDir, '../../lib/rpc-client.ts'), 'utf8');

  assert.match(rpcSource, /export function EnsureProjectChat/);
  assert.doesNotMatch(rpcSource, /export function CreateProjectChat/);
  assert.match(source, /rpcClient\.EnsureProjectChat/);
  assert.match(source, /ensureProjectChatForTabSession\(workspaceId, 'claude', undefined, true\)/);
  assert.match(source, /ensureProjectChatForTabSession\(spacePath, 'claude'\)/);
});

test('WorkspaceContainer restores active ProjectChat without forcing Claude on startup', async () => {
  const source = await fs.readFile(path.resolve(currentDir, './WorkspaceContainer.tsx'), 'utf8');

  assert.match(source, /loadActiveProjectChatForWorkspace/);
  assert.match(source, /rpcClient\.GetActiveChatForProject\(spacePath\)/);
  assert.match(source, /rpcClient\.GetProjectChat\(activeChat\.id\)/);
  assert.match(source, /const projectChat = await getInitialProjectChatForWorkspace\(workspaceId\);/);
  assert.match(source, /providerId: projectChat\.providerId/);
  assert.match(source, /if \(restoredExistingProjectChat\) \{\s*return;\s*\}/s);
  assert.doesNotMatch(source, /const projectChat = await ensureProjectChatForTabSession\(workspaceId, 'claude'\);\s*const newTabId = addTab/s);
});

test('Workspace tabs reject ProjectChat id replacement after initialization', async () => {
  const source = await fs.readFile(path.resolve(currentDir, '../../contexts/WorkspaceTabContext.tsx'), 'utf8');

  assert.match(source, /allowProjectChatRebind/);
  assert.match(source, /tab\.projectChatId &&[\s\S]*safeUpdates\.projectChatId &&[\s\S]*safeUpdates\.projectChatId !== tab\.projectChatId &&[\s\S]*!allowProjectChatRebind/);
  assert.match(source, /delete safeUpdates\.projectChatId;/);
});
