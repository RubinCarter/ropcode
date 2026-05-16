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
  assert.match(source, /if \(isTaskLifecycleSystemMessage\(message\)\) subagentMessageIndexes\.add\(index\);/);
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

test('subagent progress keeps launcher and sidechain messages visible in the root stream while still routing them to the panel', () => {
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

  // No envelope hiding: launcher (0), sidechains (2,3,4) and agentId-only (5) all stay visible.
  for (const idx of [0, 2, 3, 4, 5]) {
    assert.equal(summary.subagentMessageIndexes.has(idx), false, `index ${idx} must remain visible in main stream`);
  }
  // Orphan sidechain (no matching launcher) — index 1 has isSidechain but no parent_tool_use_id — stays visible too.
  assert.equal(summary.subagentMessageIndexes.has(1), false);

  // Depth map: launcher launches subagent at depth 1; its sidechain replies inherit depth 1.
  for (const idx of [2, 3, 4, 5]) {
    assert.equal(summary.messageDepthByIndex.get(idx), 1, `index ${idx} should be tagged depth 1`);
  }
  // Root-level launcher message itself stays at depth 0 (rendered with TaskWidget on the root indent).
  assert.equal(summary.messageDepthByIndex.get(0) ?? 0, 0);
});

test('subagent progress hides only task_progress noise and the launcher tool_result, never the sidechain content itself', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_launcher', name: 'Task', input: { description: 'Explore', prompt: 'Run task' } }],
      },
    },
    { type: 'system', subtype: 'task_started', task_id: 'task-1', tool_use_id: 'toolu_launcher', description: 'starting' },
    { type: 'assistant', parent_tool_use_id: 'toolu_launcher', message: { content: [{ type: 'text', text: 'doing' }] } },
    { type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'toolu_launcher', description: 'progress' },
    { type: 'user', message: { content: [{ tool_use_id: 'toolu_launcher', type: 'tool_result', content: 'result' }] } },
  ];

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagentMessageIndexes.has(1), true, 'task_started suppressed (TaskWidget badge covers it)');
  assert.equal(summary.subagentMessageIndexes.has(3), true, 'task_progress suppressed');
  assert.equal(summary.subagentMessageIndexes.has(4), true, 'launcher tool_result hidden — it is rendered inside TaskWidget');
  assert.equal(summary.subagentMessageIndexes.has(0), false, 'launcher message stays so TaskWidget renders');
  assert.equal(summary.subagentMessageIndexes.has(2), false, 'sidechain content stays visible');
});

test('subagent progress routes parent_tool_use_id sidechain messages into the matching subagent panel', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_launcher', name: 'Task', input: { description: 'Explore', prompt: 'Check files' } }],
      },
    },
    { type: 'user', parent_tool_use_id: 'toolu_launcher', message: { content: [{ type: 'text', text: 'subagent prompt' }] } },
    { type: 'assistant', parentToolUseID: 'toolu_launcher', message: { content: [{ type: 'text', text: 'subagent reply' }] } },
  ];

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagents.length, 1);
  const [subagent] = summary.subagents;
  assert.ok(subagent.messageIndexes.has(1), 'sidechain user prompt should be attached to the subagent');
  assert.ok(subagent.messageIndexes.has(2), 'sidechain assistant reply should be attached to the subagent');
  assert.equal(subagent.messages.length, 3, 'launcher + sidechain prompt + sidechain reply');
});

test('parent_tool_use_id messages are accounted for in token + tool counts even before transcript file appears', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_launcher', name: 'Task', input: { description: 'Explore', prompt: 'Check files' } }],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: 'toolu_launcher',
      message: {
        content: [
          { type: 'text', text: 'looking…' },
          { type: 'tool_use', id: 'toolu_inner', name: 'Read', input: {} },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    },
  ];

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagents.length, 1);
  const [subagent] = summary.subagents;
  assert.equal(subagent.toolUseCount, 1, 'inner tool_use is counted');
  assert.equal(subagent.tokenCount, 30, 'usage tokens flow into the subagent');
  assert.equal(subagent.lastActivity, 'Read', 'lastActivity tracks the most recent inner tool');
});

test('parent_tool_use_id messages without a known launcher do not crash and stay envelope-flagged for the message filter fallback', () => {
  const messages = [
    { type: 'user', parent_tool_use_id: 'toolu_unseen', message: { content: [{ type: 'text', text: 'orphan' }] } },
  ];

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagents.length, 0, 'no launcher means no subagent yet');
  assert.equal(isSubagentEnvelopeMessage(messages[0] as any), true, 'envelope predicate keeps message-filter fallback active');
});

test('parent_tool_use_id with toolUseResult.agents fallback still merges live messages onto disk transcript', () => {
  const launcherToolUseId = 'toolu_launcher';
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: launcherToolUseId, name: 'Task', input: { description: 'Explore', prompt: 'Disk transcript merge' } }],
      },
    },
    { type: 'assistant', parent_tool_use_id: launcherToolUseId, message: { content: [{ type: 'text', text: 'live progress' }] } },
  ];

  const summary = buildSubagentProgress(
    messages as any,
    { 'agent-disk': [
      { type: 'user', message: { role: 'user', content: 'Disk transcript merge' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] } },
    ] } as any,
  );

  assert.equal(summary.subagents.length, 1);
  assert.equal(summary.subagents[0].agentId, 'disk');
  assert.equal(summary.subagents[0].messageCount, 2, 'disk transcript replaces in-memory list once available');
});

test('replays a real Claude CLI stream-json capture: subagent panel sees every sidechain message AND keeps them visible in the root stream', async () => {
  const fixturePath = path.resolve(currentDir, './__fixtures__/claude-real-subagent-stream.jsonl');
  const raw = await readFile(fixturePath, 'utf8');
  const messages = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));

  const sanityHits = messages.filter((m) => m.parent_tool_use_id && typeof m.parent_tool_use_id === 'string');
  assert.ok(sanityHits.length >= 3, `fixture should contain real sidechain messages, got ${sanityHits.length}`);
  assert.ok(sanityHits.every((m) => m.isSidechain === undefined), 'real CLI stream-json does not carry isSidechain — proves the bug surface');

  const summary = buildSubagentProgress(messages as any);

  assert.equal(summary.subagents.length, 1, 'one Task launcher → one subagent');
  const [subagent] = summary.subagents;
  assert.equal(subagent.label, 'Read greet.txt file');
  assert.equal(subagent.status, 'completed', 'tool_result for the launcher tool_use_id flips status');

  const sidechainIndexes = sanityHits.map((m) => messages.indexOf(m));
  for (const idx of sidechainIndexes) {
    assert.ok(subagent.messageIndexes.has(idx), `sidechain row ${idx} must land in the panel`);
    assert.equal(summary.subagentMessageIndexes.has(idx), false, `sidechain row ${idx} must remain visible in main stream`);
    assert.equal(summary.messageDepthByIndex.get(idx), 1, `sidechain row ${idx} should be tagged as depth-1 for indent`);
  }

  const finalAssistantIdx = messages.findIndex(
    (m) => m.type === 'assistant' && m.parent_tool_use_id === null && Array.isArray(m.message?.content) && m.message.content[0]?.type === 'text',
  );
  assert.ok(finalAssistantIdx >= 0, 'fixture must include the final root-level assistant text');
  assert.equal(summary.subagentMessageIndexes.has(finalAssistantIdx), false, 'parent_tool_use_id===null must stay in main stream');

  assert.ok(subagent.messages.length >= 4, `panel transcript should contain launcher + sidechain prompt + inner tool_use + tool_result, got ${subagent.messages.length}`);
});
