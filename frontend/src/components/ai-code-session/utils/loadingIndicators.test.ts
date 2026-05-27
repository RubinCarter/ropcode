import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const aiCodeSessionPath = path.resolve(currentDir, '../AiCodeSession.tsx');
const sessionControllerPath = path.resolve(currentDir, '../SessionController.tsx');
const floatingPromptInputPath = path.resolve(currentDir, '../../FloatingPromptInput.tsx');
const sessionStatusBarPath = path.resolve(currentDir, '../SessionStatusBar.tsx');
const sessionLayoutChromePath = path.resolve(currentDir, '../layout/SessionLayoutChrome.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('renders persistent runtime status bar above the floating prompt input', async () => {
  const source = await readSource(sessionControllerPath);
  const layoutSource = await readSource(sessionLayoutChromePath);

  assert.match(
    layoutSource,
    /<div className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30">[\s\S]*?\{runtimeStatusBar\}[\s\S]*?<SessionComposer/,
  );
  assert.match(source, /runtimeStatusBar=\{runtimeStatusBar\}/);
  assert.match(source, /<RuntimeStatusBar[\s\S]*model=\{runtimeStatusBarModel\}[\s\S]*queuedPrompts=\{queueState\.queuedPrompts\}[\s\S]*queueCollapsed=\{queueState\.queuedPromptsCollapsed\}[\s\S]*onQueueCollapsedChange=\{queueState\.setQueuedPromptsCollapsed\}[\s\S]*onRemoveQueuedPrompt=\{queueState\.removeFromQueue\}[\s\S]*\/>/);
  assert.doesNotMatch(source, /const messagesList = \([\s\S]*?\{runtimeStatusBar\}[\s\S]*?<Virtuoso/);
  assert.doesNotMatch(source, /<div className="rotating-symbol text-primary"\s*\/>/);
  assert.doesNotMatch(source, /Loading session history\.\.\./);
  assert.doesNotMatch(source, /Initializing AI Code\.\.\./);
});

test('merges queued prompts into the persistent runtime status bar', async () => {
  const source = await readSource(sessionControllerPath);
  const layoutSource = await readSource(sessionLayoutChromePath);
  const statusBarSource = await readSource(sessionStatusBarPath);

  assert.doesNotMatch(source, /className="pointer-events-none absolute bottom-52 left-0 right-0 z-40 flex justify-end px-4"/);
  assert.match(layoutSource, /className="absolute bottom-0 right-0 left-0 transition-all duration-300 z-30"/);
  assert.doesNotMatch(source, /className="absolute bottom-40 left-0 right-0 z-30 px-4"/);
  assert.match(statusBarSource, /Queued Prompts \(\{queuedPrompts\.length\}\)/);
  assert.match(statusBarSource, /onQueueCollapsedChange\?\.\(!queueCollapsed\)/);
  assert.match(statusBarSource, /onRemoveQueuedPrompt\?\.\(queuedPrompt\.id\)/);
});

test('keeps session layout chrome outside the AiCodeSession shell', async () => {
  const source = await readSource(sessionControllerPath);
  const shellSource = await readSource(aiCodeSessionPath);
  const layoutSource = await readSource(sessionLayoutChromePath);

  assert.match(source, /<SessionLayoutChrome/);
  assert.doesNotMatch(shellSource, /provider-api-switch-notice/);
  assert.match(layoutSource, /provider-api-switch-notice/);
  assert.match(layoutSource, /<SplitPane/);
  assert.match(layoutSource, /<SlashCommandsManager/);
});

test('AiCodeSession is a thin exported shell over the session controller', async () => {
  const source = await readSource(aiCodeSessionPath);
  const lineCount = source.split(/\r?\n/).length;

  assert.ok(lineCount < 80, `AiCodeSession.tsx should stay a thin shell, got ${lineCount} lines`);
  assert.match(source, /export const AiCodeSession: React\.FC<AiCodeSessionProps> = \(props\) =>/);
  assert.match(source, /<SessionController \{\.\.\.props\} \/>/);
  assert.doesNotMatch(source, /api\.|wsClient|useSessionEvents|handleSendPrompt|loadSessionHistory/);
});

test('does not render legacy rotating symbol in floating prompt input loading controls', async () => {
  const source = await readSource(floatingPromptInputPath);

  assert.doesNotMatch(source, /rotating-symbol/);
});

test('terminal frame runtime reconciles stale local loading state', async () => {
  const source = await readSource(sessionControllerPath);

  assert.match(source, /const terminalFrameRuntimePhase = frameRuntimeState\.runtime\?\.phase;/);
  assert.match(source, /terminalFrameRuntimePhase === 'completed' \|\|[\s\S]*terminalFrameRuntimePhase === 'failed' \|\|[\s\S]*terminalFrameRuntimePhase === 'cancelled'/);
  assert.match(source, /if \(processState\.isLoading && terminalFrameRuntime\) \{[\s\S]*processState\.setIsLoading\(false\);[\s\S]*\}/);
});
