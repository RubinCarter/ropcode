import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const useSessionMessagesPath = path.resolve(currentDir, './useSessionMessages.ts');

async function readSource() {
  return readFile(useSessionMessagesPath, 'utf8');
}

test('calculates input output and estimated output token totals separately', async () => {
  const source = await readSource();

  assert.match(source, /export interface TokenUsageTotals \{[\s\S]*inputTokens: number;[\s\S]*outputTokens: number;[\s\S]*estimatedOutputTokens: number;[\s\S]*totalTokens: number;[\s\S]*\}/);
  assert.match(source, /function usageInputTokens\(usage\?: MessageUsage\): number \{/);
  assert.match(source, /numberValue\(usage\.input_tokens\) \+ numberValue\(usage\.cache_creation_input_tokens\) \+ numberValue\(usage\.cache_read_input_tokens\)/);
  assert.match(source, /function usageOutputTokens\(usage\?: MessageUsage\): number \{/);
  assert.match(source, /function estimateTokensForCharacters\(characterCount: number\): number \{/);
  assert.match(source, /estimatedOutputTokens: estimateTokensForCharacters\(contentLength\)/);
  assert.doesNotMatch(source, /const tokenUsage = useMemo\(\(\) => calculateTokenUsage\(messages\), \[messages\]\);/);
});

test('maintains hot message derived state incrementally', async () => {
  const source = await readSource();

  assert.match(source, /interface MessageDerivedState \{[\s\S]*tokenUsage: TokenUsageTotals;[\s\S]*agentOutputMap: Map<string, any>;[\s\S]*streamMessageContext: StreamMessageContext;[\s\S]*agentOutputToolUseIds: Map<string, string>;[\s\S]*\}/);
  assert.match(source, /function applyMessageToDerivedState\(previous: MessageDerivedState, message: ClaudeStreamMessage\): MessageDerivedState/);
  assert.match(source, /applyMessageToDerivedState\(derived, /);
  assert.match(source, /block\?\.type === 'tool_use' \|\| block\?\.type === 'server_tool_use'/);
  assert.match(source, /block\?\.tool_use_id[\s\S]*toolResults\.set\(block\.tool_use_id, block\)/);
  assert.match(source, /messageQueueRef\.current\.push\(message\);[\s\S]*scheduleFlush\(\);/);
  assert.match(source, /const flushPendingMessages = useCallback\(\(\) => \{/);
  assert.doesNotMatch(source, /const agentOutputMap = useMemo\(\(\) => \{[\s\S]*messages\.forEach[\s\S]*\}, \[messages\]\);/);
});

test('adds streaming delta output estimates and replaces them with real usage', async () => {
  const source = await readSource();

  assert.match(source, /for \(const delta of bufferedDeltas\) \{[\s\S]*estimatedOutputTokens: estimateTokensForCharacters\(bufferedText\.length\)/);
  assert.match(source, /function replaceEstimatedWithUsage\(totals: TokenUsageTotals, message: ClaudeStreamMessage\): TokenUsageTotals \{/);
  assert.match(source, /const estimatedToReplace = estimateTokensForCharacters\(textContentLength\(message\)\);/);
  assert.match(source, /estimatedOutputTokens: Math\.max\(0, totals\.estimatedOutputTokens - estimatedToReplace\)/);
});

test('does not count project chat context sync as a local user prompt for echo suppression', async () => {
  const source = await readSource();

  assert.match(source, /source !== 'broadcast' && \(message as any\)\.source !== 'projectchat_context_sync'/);
});

test('keeps provider completed text from duplicating a matching streamed delta', async () => {
  const source = await readSource();

  assert.match(source, /function mergeCompletedTextEcho/);
  assert.match(source, /messageId\(message\)/);
  assert.match(source, /return 'drop'/);
  assert.match(source, /previousText\.startsWith\(text\)/);
  assert.match(source, /!text\.includes\(previousText\)/);
  assert.match(source, /messages\[i\] = message/);
  assert.match(source, /const completedTextMerge = mergeCompletedTextEcho\(msg, msgs\)/);
});

test('uses message id when merging streaming deltas across metadata frames', async () => {
  const source = await readSource();

  assert.match(source, /interface PendingTextDelta/);
  assert.match(source, /type DeltaAppendResult = 'none' \| 'tail' \| 'non-tail'/);
  assert.match(source, /const id = messageId\(message\);/);
  assert.match(source, /findDeltaTargetIndex\(msgs, delta\.id\)/);
  assert.match(source, /appendTextToAssistantMessage\(msgs, targetIndex, bufferedText, delta\.id\)/);
  assert.match(source, /appendResult === 'non-tail'/);
  assert.match(source, /function cloneStreamMessage/);
});
