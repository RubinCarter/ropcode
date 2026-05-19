import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('first prompt triggers configured session title generation', async () => {
  const source = await readFile(path.join(currentDir, 'ai-code-session', 'AiCodeSession.tsx'), 'utf8');

  assert.match(source, /onSessionTitleGenerated/);
  assert.match(source, /generateSessionTitleViaEvent/);
  assert.match(source, /sessionState\.isFirstPrompt/);
  assert.match(source, /firstPromptForTitleRef/);
});

test('workspace chat tabs apply generated titles', async () => {
  const source = await readFile(path.join(currentDir, 'containers', 'WorkspaceContainer.tsx'), 'utf8');

  assert.match(source, /onSessionTitleGenerated/);
  assert.match(source, /updateTab\(tab\.id,\s*\{\s*title\s*\}\s*\)/s);
});

test('workspace chat tabs report completed turns for sidebar session refresh', async () => {
  const source = await readFile(path.join(currentDir, 'containers', 'WorkspaceContainer.tsx'), 'utf8');
  const types = await readFile(path.join(currentDir, 'ai-code-session', 'types.ts'), 'utf8');
  const aiCodeSession = await readFile(path.join(currentDir, 'ai-code-session', 'AiCodeSession.tsx'), 'utf8');

  assert.match(types, /onSessionActivityComplete\?:/);
  assert.match(aiCodeSession, /onSessionActivityComplete/);
  assert.match(source, /ropcode-space-sessions-refresh/);
});

test('completed new chats report the provider session id and force sidebar rescan', async () => {
  const source = await readFile(path.join(currentDir, 'containers', 'WorkspaceContainer.tsx'), 'utf8');
  const types = await readFile(path.join(currentDir, 'ai-code-session', 'types.ts'), 'utf8');
  const aiCodeSession = await readFile(path.join(currentDir, 'ai-code-session', 'AiCodeSession.tsx'), 'utf8');
  const projectList = await readFile(path.join(currentDir, 'ProjectList.tsx'), 'utf8');

  assert.match(types, /sessionId\?: string \| null/);
  assert.match(aiCodeSession, /realProviderSessionId/);
  assert.match(source, /handleSessionActivityComplete\(tab\.id,\s*sessionId\)/);
  assert.match(source, /sessionId,\s*force:\s*true/);
  assert.match(projectList, /detail\?\.force/);
  assert.match(projectList, /delete next\[spacePath\]/);
});

test('AiCodeSession reports process liveness separate from streaming', async () => {
  const source = await readFile(path.join(currentDir, 'ai-code-session', 'AiCodeSession.tsx'), 'utf8');
  const types = await readFile(path.join(currentDir, 'ai-code-session', 'types.ts'), 'utf8');

  assert.match(types, /onProcessAliveChange\?: \(isAlive: boolean\) => void/);
  assert.match(source, /onProcessAliveChange/);
  assert.match(source, /processState\.hasActiveSessionRef\.current/);
});

test('rpc client exposes GenerateSessionTitle', async () => {
  const source = await readFile(path.join(currentDir, '..', 'lib', 'rpc-client.ts'), 'utf8');

  assert.match(source, /function GenerateSessionTitle\(prompt: string\)/);
});

test('generated titles are saved against the provider session id', async () => {
  const aiCodeSession = await readFile(path.join(currentDir, 'ai-code-session', 'AiCodeSession.tsx'), 'utf8');
  const rpcClient = await readFile(path.join(currentDir, '..', 'lib', 'rpc-client.ts'), 'utf8');

  assert.match(rpcClient, /function SaveGeneratedSessionTitle/);
  assert.match(aiCodeSession, /SaveGeneratedSessionTitle/);
  assert.match(aiCodeSession, /generatedSessionTitleRef/);
});

test('historical workspace sessions deduplicate by workspace projectPath', async () => {
  const source = await readFile(path.join(currentDir, 'ProjectList.tsx'), 'utf8');

  assert.match(source, /tab\.projectPath === spacePath/);
  assert.doesNotMatch(source, /tab\.initialProjectPath === spacePath/);
});

test('Claude prompt thinking suffix never uses numeric model budgets', async () => {
  const source = await readFile(path.join(currentDir, 'FloatingPromptInput.tsx'), 'utf8');

  assert.doesNotMatch(source, /phrase: providerId === 'claude' \|\| providerId === 'gemini' \? \(t\.budget as string\) : undefined/);
  assert.match(source, /buildPromptWithThinking/);
  assert.doesNotMatch(source, /finalPrompt = `\$\{finalPrompt\}\.\\n\\n\$\{thinkingMode\.phrase\}\.`/);
});
