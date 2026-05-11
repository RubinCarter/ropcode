import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const useMessagesPath = path.resolve(currentDir, './useMessages.ts');

async function readSource() {
  return readFile(useMessagesPath, 'utf8');
}

test('calculates input output and estimated output token totals separately', async () => {
  const source = await readSource();

  assert.match(source, /export interface TokenUsageTotals \{[\s\S]*inputTokens: number;[\s\S]*outputTokens: number;[\s\S]*estimatedOutputTokens: number;[\s\S]*totalTokens: number;[\s\S]*\}/);
  assert.match(source, /function usageInputTokens\(usage\?: MessageUsage\): number \{/);
  assert.match(source, /numberValue\(usage\.input_tokens\) \+ numberValue\(usage\.cache_creation_input_tokens\) \+ numberValue\(usage\.cache_read_input_tokens\)/);
  assert.match(source, /function usageOutputTokens\(usage\?: MessageUsage\): number \{/);
  assert.match(source, /estimatedOutputTokens: Math\.round\(textContentLength\(message\) \/ 4\)/);
  assert.doesNotMatch(source, /const tokenUsage = useMemo\(\(\) => calculateTokenUsage\(messages\), \[messages\]\);/);
});

test('maintains hot message derived state incrementally', async () => {
  const source = await readSource();

  assert.match(source, /interface MessageDerivedState \{[\s\S]*tokenUsage: TokenUsageTotals;[\s\S]*agentOutputMap: Map<string, any>;[\s\S]*streamMessageContext: StreamMessageContext;[\s\S]*agentOutputToolUseIds: Map<string, string>;[\s\S]*\}/);
  assert.match(source, /function applyMessageToDerivedState\(previous: MessageDerivedState, message: ClaudeStreamMessage\): MessageDerivedState/);
  assert.match(source, /derived: applyMessageToDerivedState\(prev\.derived, message\)/);
  assert.match(source, /function replaceLastMessageInDerivedState\([\s\S]*previousMessage: ClaudeStreamMessage,[\s\S]*nextMessage: ClaudeStreamMessage/);
  assert.doesNotMatch(source, /const agentOutputMap = useMemo\(\(\) => \{[\s\S]*messages\.forEach[\s\S]*\}, \[messages\]\);/);
});
