import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const aiCodeSessionPath = path.resolve(currentDir, '../AiCodeSession.tsx');
const floatingPromptInputPath = path.resolve(currentDir, '../../FloatingPromptInput.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('renders persistent runtime status bar above the floating prompt input', async () => {
  const source = await readSource(aiCodeSessionPath);

  assert.match(
    source,
    /<div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30">[\s\S]*?\{runtimeStatusBar\}[\s\S]*?<FloatingPromptInput/,
  );
  assert.match(source, /const runtimeStatusBar = <SessionStatusBar model=\{runtimeStatusBarModel\} \/>/);
  assert.doesNotMatch(source, /const messagesList = \([\s\S]*?\{runtimeStatusBar\}[\s\S]*?<Virtuoso/);
  assert.doesNotMatch(source, /<div className="rotating-symbol text-primary"\s*\/>/);
  assert.doesNotMatch(source, /Loading session history\.\.\./);
  assert.doesNotMatch(source, /Initializing AI Code\.\.\./);
});

test('lifts scroll controls and queued prompts above the persistent status bar', async () => {
  const source = await readSource(aiCodeSessionPath);

  assert.match(source, /className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4"/);
  assert.match(source, /className="absolute bottom-40 left-0 right-0 z-30 px-4"/);
  assert.match(source, /className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30"/);
});

test('does not render legacy rotating symbol in floating prompt input loading controls', async () => {
  const source = await readSource(floatingPromptInputPath);

  assert.doesNotMatch(source, /rotating-symbol/);
});
