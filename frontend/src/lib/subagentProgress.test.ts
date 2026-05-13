import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

test('subagent progress hides live-stream messages carrying parent_tool_use_id alongside sidechain', async () => {
  const source = await readSource();

  assert.match(source, /runtimeMessage\.isSidechain === true \|\|\s*runtimeMessage\.parent_tool_use_id != null \|\|\s*runtimeMessage\.parentToolUseID != null \|\|\s*runtimeMessage\.parentToolUseId != null/);
});
