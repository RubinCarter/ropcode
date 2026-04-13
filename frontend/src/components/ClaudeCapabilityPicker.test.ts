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

test('polls warmed cache before falling back to full discovery on cache miss', async () => {
  const source = await readSource();

  assert.match(source, /for \(let attempt = 0; attempt < 8; attempt \+= 1\)/);
  assert.match(source, /await sleep\(150\);/);
  assert.match(source, /const warmed = await api\.getCachedClaudeCapabilityLayers\(projectPath\);/);
  assert.match(source, /const warmedVisibleLayers = getCachedVisibleLayers\(warmed\);/);
  assert.match(source, /if \(warmedVisibleLayers\.all_visible\.length > 0\) \{/);
});

test('guards async loading updates with a request id so stale responses do not overwrite newer state', async () => {
  const source = await readSource();

  assert.match(source, /const loadRequestIdRef = useRef\(0\);/);
  assert.match(source, /const requestId = loadRequestIdRef\.current \+ 1;/);
  assert.match(source, /const isCurrentRequest = \(\) => loadRequestIdRef\.current === requestId;/);
});

test('preserves selected capability by key during hydration updates', async () => {
  const source = await readSource();

  assert.match(source, /const selectedCapabilityKeyRef = useRef<string \| null>\(null\);/);
  assert.match(source, /const preservedIndex = orderedCapabilities\.findIndex\(\(capability\) => capability\.key === selectedKey\);/);
});

test('skips automatic refresh when cached capabilities are still fresh and uses full layers', async () => {
  const source = await readSource();

  assert.match(source, /const AUTO_REFRESH_TTL_MS = 5 \* 60 \* 1000;/);
  assert.match(source, /const shouldAutoRefresh = Boolean\(projectPath\) && !isCacheFresh\(cached\);/);
  assert.match(source, /if \(shouldAutoRefresh\) \{/);
  assert.match(source, /if \(!isCacheFresh\(warmed\)\) \{/);
  // When cache is fresh, use normalizeLayers to include project capabilities
  assert.match(source, /applyLayers\(normalizeLayers\(cached\)\);/);
  assert.match(source, /applyLayers\(normalizeLayers\(warmed\)\);/);
});
