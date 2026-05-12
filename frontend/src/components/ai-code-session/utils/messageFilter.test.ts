import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
