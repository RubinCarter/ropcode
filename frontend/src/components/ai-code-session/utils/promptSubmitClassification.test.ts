import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const classifierPath = path.resolve(currentDir, './promptSubmitClassification.ts');
const aiCodeSessionPath = path.resolve(currentDir, '../AiCodeSession.tsx');
const floatingPromptInputPath = path.resolve(currentDir, '../../FloatingPromptInput.tsx');

async function readClassifierSource() {
  return readFile(classifierPath, 'utf8');
}

async function readAiCodeSessionSource() {
  return readFile(aiCodeSessionPath, 'utf8');
}

async function readFloatingPromptInputSource() {
  return readFile(floatingPromptInputPath, 'utf8');
}

test('classifyPromptSubmit returns explicit submit actions', async () => {
  const source = await readClassifierSource();

  assert.match(source, /export type PromptSubmitClassification =/);
  assert.match(source, /\| \{ action: 'ignore'; reason: 'empty' \}/);
  assert.match(source, /\| \{ action: 'local-clear' \}/);
  assert.match(source, /\| \{ action: 'reject'; reason: 'missing-project' \}/);
  assert.match(source, /\| \{ action: 'enqueue' \}/);
  assert.match(source, /\| \{ action: 'send' \}/);
});

test('classifyPromptSubmit prioritizes empty missing project clear queue and send branches', async () => {
  const source = await readClassifierSource();

  assert.match(source, /if \(!trimmedPrompt\) \{[\s\S]*return \{ action: 'ignore', reason: 'empty' \};[\s\S]*\}/);
  assert.match(source, /if \(!input\.hasProjectPath\) \{[\s\S]*return \{ action: 'reject', reason: 'missing-project' \};[\s\S]*\}/);
  assert.match(source, /if \(shouldUseLocalClearFallback\(trimmedPrompt, input\.provider\)\) \{[\s\S]*return \{ action: 'local-clear' \};[\s\S]*\}/);
  assert.match(source, /if \(input\.isLoading && !input\.hasInteractiveSession && input\.forceFreshSession !== true\) \{[\s\S]*return \{ action: 'enqueue' \};[\s\S]*\}/);
  assert.match(source, /return \{ action: 'send' \};/);
});

test('AiCodeSession routes prompt submission through the classifier', async () => {
  const source = await readAiCodeSessionSource();

  assert.match(source, /import \{ classifyPromptSubmit \} from "\.\/utils\/promptSubmitClassification";/);
  assert.match(source, /const activeProvider = provider \|\| defaultProvider;/);
  assert.match(source, /const classification = classifyPromptSubmit\(\{[\s\S]*prompt,[\s\S]*provider: activeProvider,[\s\S]*hasProjectPath: Boolean\(sessionState\.projectPath\),[\s\S]*isLoading: processState\.isLoading,[\s\S]*hasInteractiveSession: Boolean\(processState\.interactiveSessionIdRef\.current\),[\s\S]*forceFreshSession: options\?\.forceFreshClaudeSession,[\s\S]*\}\);/);
  assert.match(source, /if \(classification\.action === 'local-clear'\) \{[\s\S]*await handleLocalClearFallback\(\);[\s\S]*return true;[\s\S]*\}/);
  assert.match(source, /if \(classification\.action === 'enqueue'\) \{[\s\S]*queueState\.addToQueue\(prompt, model, providerApiId, thinkingMode, activeProvider\);[\s\S]*return true;[\s\S]*\}/);
});

test('AiCodeSession uses selected prompt provider when starting provider sessions', async () => {
  const source = await readAiCodeSessionSource();

  assert.match(source, /provider\?: string,/);
  assert.match(source, /activeProvider === 'claude'/);
  assert.match(source, /api\.resumeProviderSession\(activeProvider,/);
  assert.match(source, /api\.startProviderSession\(activeProvider,/);
});

test('FloatingPromptInput only clears drafts when the session consumes the prompt', async () => {
  const source = await readFloatingPromptInputSource();

  assert.match(source, /onSend: \(prompt: string, model: string, providerApiId\?: string \| null, thinkingMode\?: ThinkingMode, provider\?: string\) => void \| boolean \| Promise<void \| boolean>;/);
  assert.match(source, /const consumed = await onSend\(finalPrompt, selectedModel, selectedProviderApiId, selectedThinkingMode, selectedProvider\);[\s\S]*if \(consumed === false\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setPrompt\(""\);/);
  assert.match(source, /!isExactClearCommand\(prompt\) &&[\s\S]*!shouldForwardClearToProvider\(prompt, selectedProvider\)/);
  assert.doesNotMatch(source, /shouldUseLocalClearFallback/);
});
