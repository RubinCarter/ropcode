import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, './promptThinking.ts');
const tmpDir = path.resolve(currentDir, '../../../../.tmp-test');
const compiledPath = path.join(tmpDir, 'promptThinking.test-build.mjs');

async function loadModule() {
  const source = await readFile(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  await mkdir(tmpDir, { recursive: true });
  await writeFile(compiledPath, compiled, 'utf8');
  return import(`${pathToFileURL(compiledPath).href}?t=${Date.now()}`);
}

test('does not append numeric model budgets to Claude prompts', async () => {
  const { buildPromptWithThinking } = await loadModule();

  const prompt = buildPromptWithThinking({
    provider: 'claude',
    prompt: '今天似乎心情不太好，帮我调查一下为什么。',
    phrase: '10000',
  });

  assert.equal(prompt, '今天似乎心情不太好，帮我调查一下为什么。');
});

test('only accepts known Claude prompt-thinking phrases', async () => {
  const { isClaudePromptThinkingPhrase } = await loadModule();

  assert.equal(isClaudePromptThinkingPhrase('think'), true);
  assert.equal(isClaudePromptThinkingPhrase('think hard'), true);
  assert.equal(isClaudePromptThinkingPhrase('10000'), false);
  assert.equal(isClaudePromptThinkingPhrase(''), false);
  assert.equal(isClaudePromptThinkingPhrase(undefined), false);
});

test('appends known Claude prompt-thinking phrases only for Claude', async () => {
  const { buildPromptWithThinking } = await loadModule();

  assert.equal(
    buildPromptWithThinking({ provider: 'claude', prompt: '检查这个问题', phrase: 'think hard' }),
    '检查这个问题.\n\nthink hard.',
  );

  assert.equal(
    buildPromptWithThinking({ provider: 'gemini', prompt: '检查这个问题', phrase: 'think hard' }),
    '检查这个问题',
  );
});
