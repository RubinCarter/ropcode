import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const presentationPath = path.resolve(currentDir, './sessionStatusBarPresentation.ts');

async function readSource() {
  return readFile(presentationPath, 'utf8');
}

async function loadModule() {
  try {
    return await import('./sessionStatusBarPresentation');
  } catch (error) {
    assert.fail(`sessionStatusBarPresentation module not implemented: ${error}`);
  }
}

test('buildSessionStatusBarModel keeps a persistent ready state while idle without thinking-cycle hints', async () => {
  const source = await readSource();

  assert.match(source, /return \{ primary: 'Ready', secondary: null, glyph: 'idle', tone: 'neutral' \};/);
  assert.doesNotMatch(source, /Shift\+Tab.*thinking|cycle-thinking|thinkingCycleEnabled/);
});

test('buildSessionStatusBarModel prioritizes active tool state with elapsed and directional token metrics', async () => {
  const source = await readSource();

  assert.match(source, /if \(runtime\.phase === 'tool_running' && runtime\.activeTool\) \{/);
  assert.match(source, /primary: `Running \$\{runtime\.activeTool\}…`/);
  assert.match(source, /metrics\.push\(\{ key: 'elapsed', label: formatDuration\(elapsedMs\), priority: 'high' \}\)/);
  assert.match(source, /metrics\.push\(\{ key: 'input-tokens', label: `↑ \$\{formatCompactNumber\(tokenUsage\.inputTokens\)\}`, priority: 'high' \}\)/);
  assert.match(source, /metrics\.push\(\{ key: 'output-tokens', label: `↓ \$\{approximate\}\$\{formatCompactNumber\(visibleOutputTokens\)\}`, priority: 'high' \}\)/);
  assert.doesNotMatch(source, /response-tokens/);
});

test('buildSessionStatusBarModel reports active and retained completed thinking duration', async () => {
  const source = await readSource();

  assert.match(source, /return `thinking \$\{formatDuration\(Math\.max\(0, now - thinkingStatus\.startedAt\)\)\}`;/);
  assert.match(source, /if \(now - thinkingStatus\.completedAt <= 2_000\) \{/);
  assert.match(source, /return `thought for \$\{formatDuration\(thinkingStatus\.durationMs\)\}`;/);
});

test('buildSessionStatusBarModel shows compaction before generic work labels', async () => {
  const source = await readSource();

  assert.match(source, /if \(runtime\.phase === 'compacting'\) \{/);
  assert.match(source, /primary: 'Compacting context…'/);
  assert.match(source, /runtime\.phase === 'compacting'[\s\S]*currentTodoActiveForm/);
});

test('buildSessionStatusBarModel summarizes subagent activity without raw event names', async () => {
  const source = await readSource();

  assert.match(source, /const runtimeCanHaveRunningWork = runtime\.phase !== 'idle' && runtime\.phase !== 'completed' && runtime\.phase !== 'failed' && runtime\.phase !== 'cancelled';/);
  assert.match(source, /const hasRunningSubagents = runtimeCanHaveRunningWork && subagentProgress\.runningCount > 0;/);
  assert.match(source, /return \{ primary: 'Running subagents…'/);
  assert.match(source, /label: agentParts \|\| `\$\{subagentProgress\.subagents\.length\} agents`/);
  assert.match(source, /`\$\{formatCompactNumber\(subagentProgress\.totalTokenCount\)\} agent tokens`/);
  assert.doesNotMatch(source, /task_progress|claude-output/);
});

test('buildSessionStatusBarModel treats cancelled sessions as terminal after stop completes', async () => {
  const { buildSessionStatusBarModel } = await loadModule();

  const model = buildSessionStatusBarModel({
    runtime: {
      phase: 'cancelled',
      label: 'Cancelled',
      detail: null,
      severity: 'warning',
      activeTool: null,
      toolProgressText: null,
      retry: null,
      rateLimited: false,
      transportState: 'connected',
      waitingReason: null,
      isStuckLikely: false,
      lastUpdatedAt: 10_000,
    },
    runtimeCopy: {
      primary: 'Cancelled',
      secondary: null,
      chips: [],
      tone: 'warning',
    },
    now: 20_000,
    loadingStartedAt: 1_000,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedOutputTokens: 0,
      totalTokens: 0,
    },
    subagentProgress: {
      subagents: [],
      rootMessages: [],
      rootMessageIndexes: new Set(),
      subagentMessageIndexes: new Set(),
      runningCount: 0,
      completedCount: 0,
      failedCount: 0,
      totalToolUseCount: 0,
      totalTokenCount: 0,
    },
    promptConfig: { provider: 'claude', model: 'sonnet' },
    isLoading: false,
    interactiveSessionId: null,
    stopVisible: false,
    queuedPromptsCount: 0,
    thinkingStatus: null,
  });

  assert.equal(model.primary, 'Cancelled');
  assert.equal(model.isActive, false);
  assert.equal(model.glyph, 'warning');
  assert.equal(model.tone, 'warning');
  assert.deepEqual(model.metrics, []);
  assert.equal(model.hints.some((hint) => hint.key === 'interrupt'), false);
});

test('buildSessionStatusBarModel treats completed interactive Claude sessions as idle for stop controls', async () => {
  const { buildSessionStatusBarModel } = await loadModule();

  const model = buildSessionStatusBarModel({
    runtime: {
      phase: 'completed',
      label: 'Completed',
      detail: 'Result: success',
      severity: 'success',
      activeTool: null,
      toolProgressText: null,
      retry: null,
      rateLimited: false,
      transportState: 'connected',
      waitingReason: null,
      isStuckLikely: false,
      lastUpdatedAt: 10_000,
    },
    runtimeCopy: {
      primary: 'Completed',
      secondary: 'Result: success',
      chips: [],
      tone: 'success',
    },
    now: 20_000,
    loadingStartedAt: null,
    tokenUsage: {
      inputTokens: 98_200,
      outputTokens: 55,
      estimatedOutputTokens: 0,
      totalTokens: 98_255,
    },
    subagentProgress: {
      subagents: [],
      rootMessages: [],
      rootMessageIndexes: new Set(),
      subagentMessageIndexes: new Set(),
      runningCount: 0,
      completedCount: 0,
      failedCount: 0,
      totalToolUseCount: 0,
      totalTokenCount: 0,
    },
    promptConfig: { provider: 'claude', model: 'sonnet' },
    isLoading: false,
    interactiveSessionId: 'interactive-123',
    stopVisible: false,
    queuedPromptsCount: 0,
    thinkingStatus: null,
  });

  assert.equal(model.primary, 'Completed');
  assert.equal(model.isActive, false);
  assert.equal(model.hints.some((hint) => hint.key === 'interrupt'), false);
  assert.equal(model.metrics.some((metric) => metric.key === 'elapsed'), false);
});
