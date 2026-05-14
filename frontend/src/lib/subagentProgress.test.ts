import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSubagentProgress, isSubagentEnvelopeMessage } from './subagentProgress';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, './subagentProgress.ts');

async function readSource() {
  return readFile(sourcePath, 'utf8');
}

test('subagent progress treats task_started as a grouped runtime bookend', async () => {
  const source = await readSource();

  assert.match(source, /if \(message\.type !== "system" \|\| !message\.task_id \|\| \(message\.subtype !== "task_progress" && message\.subtype !== "task_started"\)\) \{[\s\S]*return false;[\s\S]*\}/);
  assert.match(source, /if \(message\.type === "system" && \(message\.subtype === "task_progress" \|\| message\.subtype === "task_started"\)\) return true;/);
  assert.match(source, /if \(shouldHideGroupedMessage\(message\)\) subagentMessageIndexes\.add\(index\);/);
});

test('subagent progress still groups transcripts through the canonical merge path', async () => {
  const source = await readSource();

  assert.match(source, /for \(const \[rawAgentId, transcript\] of Object\.entries\(subagentTranscripts\)\)/);
  assert.match(source, /const matchedByPrompt = !matchedByAgentId/);
  assert.match(source, /subagent\.messages = transcript;/);
  assert.match(source, /return \{\n    subagents,/);
});

test('subagent envelope predicate hides explicit sidechain and parent tool messages only', () => {
  assert.equal(isSubagentEnvelopeMessage({ isSidechain: true }), true);
  assert.equal(isSubagentEnvelopeMessage({ parent_tool_use_id: 'toolu_1' }), true);
  assert.equal(isSubagentEnvelopeMessage({ parentToolUseID: 'toolu_1' }), true);
  assert.equal(isSubagentEnvelopeMessage({ parentToolUseId: 'toolu_1' }), true);
  assert.equal(isSubagentEnvelopeMessage({ agentId: 'agent-1' }), false);
  assert.equal(isSubagentEnvelopeMessage({ agent_id: 'agent-1' }), false);
});

test('subagent progress hides explicit envelopes but not agentId-only root messages', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_launcher', name: 'Task', input: { description: 'Explore', prompt: 'Check files', agentId: 'agent-1' } }],
      },
    },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'sidechain' }] } },
    { type: 'user', parent_tool_use_id: 'toolu_launcher', message: { content: [{ type: 'text', text: 'subagent prompt' }] } },
    { type: 'assistant', parentToolUseID: 'toolu_launcher', message: { content: [{ type: 'text', text: 'alias 1' }] } },
    { type: 'assistant', parentToolUseId: 'toolu_launcher', message: { content: [{ type: 'text', text: 'alias 2' }] } },
    { type: 'assistant', agentId: 'agent-1', message: { content: [{ type: 'text', text: 'root-visible correlated message' }] } },
  ];

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagentMessageIndexes.has(1), true);
  assert.equal(summary.subagentMessageIndexes.has(2), true);
  assert.equal(summary.subagentMessageIndexes.has(3), true);
  assert.equal(summary.subagentMessageIndexes.has(4), true);
  assert.equal(summary.subagentMessageIndexes.has(5), false);
});
