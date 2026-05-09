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

test('buildSessionStatusBarModel keeps a persistent ready state while idle', async () => {
  const source = await readSource();

  assert.match(source, /return \{ primary: 'Ready', secondary: null, glyph: 'idle', tone: 'neutral' \};/);
  assert.match(source, /hints\.push\(\{ key: 'cycle-thinking', label: 'Shift\+Tab cycle thinking', priority: 'medium' \}\)/);
});

test('buildSessionStatusBarModel prioritizes active tool state with elapsed and token metrics', async () => {
  const source = await readSource();

  assert.match(source, /if \(runtime\.phase === 'tool_running' && runtime\.activeTool\) \{/);
  assert.match(source, /primary: `Running \$\{runtime\.activeTool\}…`/);
  assert.match(source, /metrics\.push\(\{ key: 'elapsed', label: formatDuration\(elapsedMs\), priority: 'high' \}\)/);
  assert.match(source, /metrics\.push\(\{ key: 'tokens', label: `\$\{formatCompactNumber\(totalTokens\)\} tokens`, priority: 'high' \}\)/);
});

test('buildSessionStatusBarModel reports active and retained completed thinking duration', async () => {
  const source = await readSource();

  assert.match(source, /return `thinking \$\{formatDuration\(Math\.max\(0, now - thinkingStatus\.startedAt\)\)\}`;/);
  assert.match(source, /if \(now - thinkingStatus\.completedAt <= 2_000\) \{/);
  assert.match(source, /return `thought for \$\{formatDuration\(thinkingStatus\.durationMs\)\}`;/);
});

test('buildSessionStatusBarModel summarizes subagent activity without raw event names', async () => {
  const source = await readSource();

  assert.match(source, /const hasRunningSubagents = subagentProgress\.runningCount > 0;/);
  assert.match(source, /return \{ primary: 'Running subagents…'/);
  assert.match(source, /label: agentParts \|\| `\$\{subagentProgress\.subagents\.length\} agents`/);
  assert.match(source, /`\$\{formatCompactNumber\(subagentProgress\.totalTokenCount\)\} agent tokens`/);
  assert.doesNotMatch(source, /task_progress|claude-output/);
});
