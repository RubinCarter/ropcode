import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getDisplayableMessages } from './messageFilter';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const messageFilterPath = path.resolve(currentDir, './messageFilter.ts');

async function readSource() {
  return readFile(messageFilterPath, 'utf8');
}

test('filters user messages that would render as empty rows', async () => {
  const source = await readSource();

  assert.match(source, /function hasRenderableUserContent\([\s\S]*toolUseNamesById: Map<string, string>[\s\S]*\): boolean/);
  assert.match(source, /const topLevelContent = \(message as any\)\.content;/);
  assert.match(source, /return isNonEmptyText\(topLevelContent\);/);
  assert.match(source, /if \(!nestedContent\) \{[\s\S]*return false;/);
  assert.match(source, /return nestedContent\.some\(\(content: any\) => isRenderableUserContentBlock\(content, toolUseNamesById\)\);/);
  assert.doesNotMatch(source, /if \(message\.type === "user" && message\.message\)/);
});

test('filters all messages through the StreamMessage renderability gate before creating virtual rows', async () => {
  const source = await readSource();

  assert.match(source, /function wouldStreamMessageRender\([\s\S]*message: ClaudeStreamMessage,[\s\S]*toolUseNamesById: Map<string, string>[\s\S]*\): boolean/);
  assert.match(source, /if \(!wouldStreamMessageRender\(message, toolUseNamesById\)\) \{[\s\S]*return false;/);
  assert.match(source, /return summarizeRuntimeMessage\(message as any\) !== null;/);
});

test('filters assistant messages that only contain hidden or empty content', async () => {
  const source = await readSource();

  assert.match(source, /function hasRenderableAssistantContent\(message: ClaudeStreamMessage\): boolean/);
  assert.match(source, /if \(message\.type === "assistant" && message\.message\) \{[\s\S]*return hasRenderableAssistantContent\(message\);/);
  assert.match(source, /if \(toolName === 'agentoutputtool'\) return false;/);
  assert.match(source, /return isNonEmptyText\(content\.text\);/);
});

test('display filter no longer drops sidechain messages — they render in main stream with depth styling at the call site', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /isSubagentEnvelopeMessage/);
  assert.doesNotMatch(source, /import.*subagentProgress/);
});

test('display filter still honors hidden indexes for caller-supplied subagent message routing', () => {
  const messages = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', agentId: 'agent-1', message: { content: [{ type: 'text', text: 'visible correlated root text' }] } },
    { type: 'user', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'text', text: 'subagent prompt' }] } },
    { type: 'assistant', parentToolUseID: 'toolu_1', message: { content: [{ type: 'text', text: 'subagent alias 1' }] } },
    { type: 'assistant', parentToolUseId: 'toolu_1', message: { content: [{ type: 'text', text: 'subagent alias 2' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'sidechain text' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'normal root text' }] } },
  ];

  // Without hiddenIndexes, every renderable message including sidechains stays visible.
  const allDisplayable = getDisplayableMessages(messages as any);
  assert.deepEqual(allDisplayable.indexes, [0, 1, 2, 3, 4, 5, 6]);

  // The caller can still hide specific indexes (e.g. task lifecycle noise from buildSubagentProgress).
  const hidden = new Set([2, 5]);
  const filtered = getDisplayableMessages(messages as any, hidden);
  assert.deepEqual(filtered.indexes, [0, 1, 3, 4, 6]);
});

test('display filter honors hidden indexes before envelope fallback', () => {
  const messages = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'root text' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'indexed subagent text' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'other root text' }] } },
  ];

  assert.deepEqual(getDisplayableMessages(messages as any, new Set([1])).indexes, [0, 2]);
});

test('display filter collapses consecutive transient runtime events into the latest one', () => {
  const messages = [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 5 },
    { type: 'error', error: 'server_error 1' },
    { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5 },
    { type: 'error', error: 'server_error 2' },
    { type: 'system', subtype: 'api_retry', attempt: 3, max_retries: 5 },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 5 },
  ];

  const displayable = getDisplayableMessages(messages as any);

  // Keep init, the latest transient before the assistant reply, the assistant reply,
  // and the standalone trailing transient.
  assert.deepEqual(displayable.indexes, [0, 5, 6, 7]);
});
