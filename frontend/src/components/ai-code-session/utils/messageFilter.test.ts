import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getDisplayableMessages, createDisplayableMessagesAccumulator } from './messageFilter';

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

test('display filter hides rate-limit retry events consumed by runtime status', () => {
  const messages = [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 5, error: 'rate_limit' },
    { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', message: 'too many requests' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } },
    { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5, error: 'rate_limit' },
  ];

  const displayable = getDisplayableMessages(messages as any);

  assert.deepEqual(displayable.indexes, [0, 3]);
});

test('display filter collapses consecutive transient runtime errors into the latest one', () => {
  const messages = [
    { type: 'system', subtype: 'init' },
    { type: 'error', error: 'server_error 1' },
    { type: 'system', subtype: 'error', error: 'server_error 2' },
    { type: 'raw', content: 'raw diagnostic' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } },
    { type: 'error', error: 'server_error 3' },
  ];

  const displayable = getDisplayableMessages(messages as any);

  assert.deepEqual(displayable.indexes, [0, 3, 4, 5]);
});

// 增量 accumulator 跟 stateless getDisplayableMessages 必须 100% 等价：
// 任意 prefix 上 apply 出的 indexes / messages 都应等于直接对该 prefix 调用 stateless 的结果。
test('incremental accumulator matches stateless getDisplayableMessages on every prefix', () => {
  const messages = [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 5, error: 'rate_limit' },
    { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', message: 'too many' } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'reply 1' }] } },
    { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5, error: 'rate_limit' },
    { type: 'error', error: 'server_error 1' },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'toolu_1', name: 'task' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } },
    { type: 'assistant', message: { id: 'm3', content: [{ type: 'text', text: 'reply 2' }] } },
  ];

  const acc = createDisplayableMessagesAccumulator();
  for (let n = 0; n <= messages.length; n++) {
    const prefix = messages.slice(0, n);
    const expected = getDisplayableMessages(prefix as any);
    const actual = acc.apply(prefix as any);
    assert.deepEqual(actual.indexes, expected.indexes, `indexes mismatch at length=${n}`);
    assert.deepEqual(actual.messages, expected.messages, `messages mismatch at length=${n}`);
  }
});

test('incremental accumulator matches stateless when hiddenIndexes ref changes mid-stream', () => {
  const messages = [
    { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'pre' }] } },
    { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'pre+1' }] } },
    { type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'toolu_1', name: 'task' }] } },
    { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'next' }] } },
  ];

  const acc = createDisplayableMessagesAccumulator();

  // 第一次：无 hidden
  const first = acc.apply(messages.slice(0, 3) as any);
  assert.deepEqual(first.indexes, getDisplayableMessages(messages.slice(0, 3) as any).indexes);

  // 第二次：把 launcher (index 2) 标 hidden，应触发 rebuild + supersede 同 msgId 的 0,1
  const hidden1 = new Set([2]);
  const second = acc.apply(messages.slice(0, 3) as any, hidden1);
  assert.deepEqual(
    second.indexes,
    getDisplayableMessages(messages.slice(0, 3) as any, hidden1).indexes,
  );

  // 第三次：append 新消息，hidden ref 不变，走增量分支
  const third = acc.apply(messages as any, hidden1);
  assert.deepEqual(third.indexes, getDisplayableMessages(messages as any, hidden1).indexes);

  // 第四次：hidden ref 换成新空 Set，rebuild
  const hidden2 = new Set<number>();
  const fourth = acc.apply(messages as any, hidden2);
  assert.deepEqual(fourth.indexes, getDisplayableMessages(messages as any, hidden2).indexes);
});

test('incremental accumulator handles array shrink (e.g. session reset) via full rebuild', () => {
  const long = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'c' }] } },
  ];

  const acc = createDisplayableMessagesAccumulator();
  acc.apply(long as any);

  const short = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'fresh' }] } }];
  const result = acc.apply(short as any);
  assert.deepEqual(result.indexes, getDisplayableMessages(short as any).indexes);
  assert.deepEqual(result.messages, getDisplayableMessages(short as any).messages);
});
