import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const streamMessagePath = path.resolve(currentDir, './StreamMessage.tsx');
const aiCodeSessionPath = path.resolve(currentDir, './ai-code-session/AiCodeSession.tsx');
const agentExecutionPath = path.resolve(currentDir, './AgentExecution.tsx');
const sessionOutputViewerPath = path.resolve(currentDir, './SessionOutputViewer.tsx');
const agentRunOutputViewerPath = path.resolve(currentDir, './AgentRunOutputViewer.tsx');

async function readSource(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('StreamMessage builds shared stream context outside individual message effects', async () => {
  const source = await readSource(streamMessagePath);

  assert.match(source, /export function buildStreamMessageContext\(streamMessages: ClaudeStreamMessage\[\]\): StreamMessageContext/);
  assert.doesNotMatch(source, /setToolResults/);
  assert.doesNotMatch(source, /setCwd/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]*streamMessages\.forEach[\s\S]*\}, \[streamMessages\]\);/);
});

test('live message renderers pass memoized stream context to StreamMessage', async () => {
  const aiCodeSessionSource = await readSource(aiCodeSessionPath);
  const agentExecutionSource = await readSource(agentExecutionPath);
  const sessionOutputViewerSource = await readSource(sessionOutputViewerPath);
  const agentRunOutputViewerSource = await readSource(agentRunOutputViewerPath);

  for (const source of [aiCodeSessionSource, agentExecutionSource, sessionOutputViewerSource, agentRunOutputViewerSource]) {
    assert.match(source, /buildStreamMessageContext/);
    assert.match(source, /streamContext=\{streamMessageContext\}/);
  }
});
