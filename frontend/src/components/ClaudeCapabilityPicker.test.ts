import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const pickerPath = path.resolve(currentDir, './ClaudeCapabilityPicker.tsx');

async function readSource() {
  return readFile(pickerPath, 'utf8');
}

test('shows staged project loading instead of blocking the whole picker when cached capabilities exist', async () => {
  const source = await readSource();

  assert.match(source, /const showFullScreenLoading = isInitialLoading && !hasAnyCapabilities;/);
  assert.match(source, /const showInlineProjectLoading = isProjectLoading && hasAnyCapabilities;/);
  assert.match(source, /Loading project capabilities/);
});

test('preserves selected capability by key during hydration updates', async () => {
  const source = await readSource();

  assert.match(source, /const selectedCapabilityKeyRef = useRef<string \| null>\(null\);/);
  assert.match(source, /const preservedIndex = orderedCapabilities\.findIndex\(\(capability\) => capability\.key === selectedKey\);/);
});

test('retries by reloading without passing an invalid load argument', async () => {
  const source = await readSource();

  assert.match(source, /onClick=\{\(\) => void loadCapabilities\(\)\}/);
  assert.doesNotMatch(source, /loadCapabilities\(true\)/);
});
