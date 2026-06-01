import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const pickerPath = path.resolve(currentDir, './ProviderCapabilityPicker.tsx');

async function readSource() {
  return readFile(pickerPath, 'utf8');
}

test('shows staged project loading instead of blocking the whole picker when cached capabilities exist', async () => {
  const source = await readSource();

  assert.match(source, /const showFullScreenLoading = isInitialLoading && !hasAnyCapabilities;/);
  assert.match(source, /const showInlineProjectLoading = isProjectLoading && hasAnyCapabilities;/);
  assert.match(source, /showInlineProjectLoading && \(/);
  assert.match(source, /projectCapabilityCount > 0/);
});

test('loads provider discovery on cache miss without polling stale prewarm data', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /for \(let attempt = 0; attempt < 8; attempt \+= 1\)/);
  assert.doesNotMatch(source, /await sleep\(150\);/);
  assert.doesNotMatch(source, /prewarmClaudeCapabilityLayers/);
  assert.match(source, /const layers: ProviderCapabilityLayers = await api\.getProviderCapabilityLayers\(provider, projectPath\);/);
  assert.doesNotMatch(source, /api\.getClaudeCapabilityLayers/);
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
  assert.doesNotMatch(source, /const cachedVisibleLayers = getCachedVisibleLayers\(cached\);/);
  assert.match(source, /if \(shouldAutoRefresh\) \{/);
  // When cache is fresh, use normalizeLayers to include project capabilities
  assert.match(source, /const cachedLayers = normalizeLayers\(cached\);/);
  assert.match(source, /applyLayers\(cachedLayers\);/);
});

test('does not hide discovery failures behind local built-in data', async () => {
  const source = await readSource();

  assert.doesNotMatch(source, /BUILT_IN_CAPABILITIES/);
  assert.doesNotMatch(source, /BUILT_IN_LAYERS/);
  assert.match(source, /applyLayers\(EMPTY_LAYERS\);/);
});
