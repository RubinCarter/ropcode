import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const streamMessagePath = path.resolve(currentDir, './StreamMessage.tsx');
const streamMessageContextPath = path.resolve(currentDir, './stream-message/context.ts');
const streamMessageRenderingPath = path.resolve(currentDir, './stream-message/rendering.tsx');
const messageStreamViewPath = path.resolve(currentDir, './ai-code-session/MessageStreamView.tsx');
const aiCodeSessionPath = path.resolve(currentDir, './ai-code-session/AiCodeSession.tsx');
const agentExecutionPath = path.resolve(currentDir, './AgentExecution.tsx');
const sessionOutputViewerPath = path.resolve(currentDir, './SessionOutputViewer.tsx');
const agentRunOutputViewerPath = path.resolve(currentDir, './AgentRunOutputViewer.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('StreamMessage builds shared stream context outside individual message effects', async () => {
  const source = await readSource(streamMessageContextPath);

  assert.match(source, /export function buildStreamMessageContext\(streamMessages: ClaudeStreamMessage\[\]\): StreamMessageContext/);
  assert.doesNotMatch(source, /setToolResults/);
  assert.doesNotMatch(source, /setCwd/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]*streamMessages\.forEach[\s\S]*\}, \[streamMessages\]\);/);
  assert.doesNotMatch(source, /const fallbackStreamContext = useMemo\(\(\) => buildStreamMessageContext\(streamMessages\), \[streamMessages\]\);/);
});

test('StreamMessage memoization ignores unrelated stream context churn', async () => {
  const contextSource = await readSource(streamMessageContextPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(contextSource, /export function streamMessagePropsAreEqual\(prev: StreamMessageProps, next: StreamMessageProps\): boolean/);
  assert.match(contextSource, /if \(prev\.message !== next\.message\) return false;/);
  assert.match(contextSource, /if \(!prevContext \|\| !nextContext\) \{[\s\S]*return prev\.streamMessages === next\.streamMessages && prev\.agentOutputMap === next\.agentOutputMap;[\s\S]*\}/);
  assert.match(contextSource, /prevContext\.toolResults\.get\(toolUseId\) !== nextContext\.toolResults\.get\(toolUseId\)/);
  assert.match(streamMessageSource, /export const StreamMessage = React\.memo\(StreamMessageComponent, streamMessagePropsAreEqual\);/);
});

test('StreamMessage shares Claude agent metadata across mounted rows', async () => {
  const source = await readSource(streamMessageRenderingPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(source, /let cachedAgents: AgentPresentationMap = new Map\(\);/);
  assert.match(source, /let agentsLoadPromise: Promise<void> \| null = null;/);
  assert.match(source, /function loadAgentsOnce\(\): void \{/);
  assert.match(streamMessageSource, /const agents = useSyncExternalStore\(subscribeAgents, getAgentsSnapshot, getAgentsSnapshot\);/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]*api\.listClaudeAgents\(\)[\s\S]*\}, \[\]\);/);
});

test('StreamMessage binds server tool results for history views', async () => {
  const contextSource = await readSource(streamMessageContextPath);
  const streamMessageSource = await readSource(streamMessagePath);

  assert.match(contextSource, /content\.type === "tool_use" \|\| content\.type === "server_tool_use"/);
  assert.match(contextSource, /if \(content\.tool_use_id\) \{[\s\S]*toolResults\.set\(content\.tool_use_id, content\);[\s\S]*\}/);
  assert.match(streamMessageSource, /content\.type === "tool_use" \|\| content\.type === "server_tool_use"/);
  assert.match(streamMessageSource, /toolName === "websearch" \|\| toolName === "web_search"/);
});

test('live message renderers pass memoized stream context to StreamMessage', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const sessionOutputViewerSource = await readSource(sessionOutputViewerPath);
  const agentRunOutputViewerSource = await readSource(agentRunOutputViewerPath);

  assert.doesNotMatch(aiCodeSessionSource, /buildStreamMessageContext\(messagesState\.messages\)/);
  assert.match(await readSource(messageStreamViewPath), /streamContext=\{messagesState\.streamMessageContext\}/);

  for (const source of [agentExecutionSource, sessionOutputViewerSource, agentRunOutputViewerSource]) {
    assert.match(source, /buildStreamMessageContext/);
    assert.match(source, /streamContext=\{streamMessageContext\}/);
  }
});
