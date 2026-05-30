import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('OutputCache polls agent run output instead of provider session output', () => {
  const source = readFileSync(join(__dirname, 'outputCache.tsx'), 'utf8');

  assert.match(source, /api\.listRunningAgentRuns\(\)/);
  assert.match(source, /api\.getAgentRunOutput\(runId\)/);
  assert.doesNotMatch(source, /api\.getSessionOutput\(sessionId\)/);
  assert.match(source, /isExpectedAgentRunOutputMiss\(error\)/);
  assert.match(source, /staleRunIdsRef\.current\.add\(runId\)/);
  assert.doesNotMatch(source, /Failed to update cache for agent run \$\{runId\}/);
});
