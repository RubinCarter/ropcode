import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const aiCodeSessionPath = path.resolve(currentDir, '../AiCodeSession.tsx');
const floatingPromptInputPath = path.resolve(currentDir, '../../FloatingPromptInput.tsx');
const sessionStatusBarPath = path.resolve(currentDir, '../SessionStatusBar.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('renders persistent runtime status bar above the floating prompt input', async () => {
  const source = await readSource(aiCodeSessionPath);

  assert.match(
    source,
    /<div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30">[\s\S]*?\{runtimeStatusBar\}[\s\S]*?<FloatingPromptInput/,
  );
  assert.match(source, /const runtimeStatusBar = \([\s\S]*<SessionStatusBar[\s\S]*model=\{runtimeStatusBarModel\}[\s\S]*queuedPrompts=\{queueState\.queuedPrompts\}[\s\S]*queueCollapsed=\{queueState\.queuedPromptsCollapsed\}[\s\S]*onQueueCollapsedChange=\{queueState\.setQueuedPromptsCollapsed\}[\s\S]*onRemoveQueuedPrompt=\{queueState\.removeFromQueue\}[\s\S]*\/?>[\s\S]*\);/);
  assert.doesNotMatch(source, /const messagesList = \([\s\S]*?\{runtimeStatusBar\}[\s\S]*?<Virtuoso/);
  assert.doesNotMatch(source, /<div className="rotating-symbol text-primary"\s*\/>/);
  assert.doesNotMatch(source, /Loading session history\.\.\./);
  assert.doesNotMatch(source, /Initializing AI Code\.\.\./);
});

test('merges queued prompts into the persistent runtime status bar', async () => {
  const source = await readSource(aiCodeSessionPath);
  const statusBarSource = await readSource(sessionStatusBarPath);

  assert.match(source, /className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4"/);
  assert.match(source, /className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30"/);
  assert.doesNotMatch(source, /className="absolute bottom-40 left-0 right-0 z-30 px-4"/);
  assert.match(statusBarSource, /Queued Prompts \(\{queuedPrompts\.length\}\)/);
  assert.match(statusBarSource, /onQueueCollapsedChange\?\.\(!queueCollapsed\)/);
  assert.match(statusBarSource, /onRemoveQueuedPrompt\?\.\(queuedPrompt\.id\)/);
});

test('does not render legacy rotating symbol in floating prompt input loading controls', async () => {
  const source = await readSource(floatingPromptInputPath);

  assert.doesNotMatch(source, /rotating-symbol/);
});
