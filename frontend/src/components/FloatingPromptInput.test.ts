import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const floatingPromptInputPath = path.resolve(currentDir, './FloatingPromptInput.tsx');

async function readSource() {
  return readFile(floatingPromptInputPath, 'utf8');
}

test('syncs selected provider state when defaultProvider prop changes', async () => {
  const source = await readSource();

  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*setSelectedProvider\(defaultProvider\)[\s\S]*\}, \[defaultProvider\]\)/,
  );
});

test('uses defaultProvider directly for Claude capability picker branch', async () => {
  const source = await readSource();

  assert.match(source, /const usesClaudeCapabilityPicker = defaultProvider === 'claude';/);
  assert.doesNotMatch(source, /const usesClaudeCapabilityPicker = selectedProvider === 'claude';/);
});
