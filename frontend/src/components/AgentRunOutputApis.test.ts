import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('agent run viewers keep run IDs separate from provider session IDs', () => {
  const sessionViewer = readFileSync(join(__dirname, 'SessionOutputViewer.tsx'), 'utf8');
  const agentViewer = readFileSync(join(__dirname, 'AgentRunOutputViewer.tsx'), 'utf8');

  assert.match(sessionViewer, /api\.getAgentRunOutput\(session\.id\)/);
  assert.doesNotMatch(sessionViewer, /api\.getSessionOutput\(session\.id\)/);
  assert.match(sessionViewer, /api\.streamSessionOutput\(session\.project_path \|\| '', session\.session_id\)/);
  assert.doesNotMatch(sessionViewer, /api\.streamSessionOutput\(session\.id\)/);

  assert.match(agentViewer, /api\.streamSessionOutput\(run\.project_path \|\| '', run\.session_id\)/);
  assert.doesNotMatch(agentViewer, /api\.streamSessionOutput\(run\.id\)/);
});
