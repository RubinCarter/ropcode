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
  assert.match(source, /estimatedOutputTokens \+= Math\.round\(textContentLength\(message\) \/ 4\);/);
  assert.match(source, /const tokenUsage = useMemo\(\(\) => calculateTokenUsage\(messages\), \[messages\]\);/);
});
