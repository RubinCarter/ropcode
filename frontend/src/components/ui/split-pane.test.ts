import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const splitPanePath = path.resolve(currentDir, './split-pane.tsx');

async function readSource() {
  return readFile(splitPanePath, 'utf8');
}

test('SplitPane clamps split position when container resizes', async () => {
  const source = await readSource();

  assert.match(source, /const clampSplitPosition = useCallback\(\(position: number, containerWidth: number\) => \{/);
  assert.match(source, /if \(containerWidth <= minLeftWidth \+ minRightWidth\) \{/);
  assert.match(source, /const observer = new ResizeObserver\(\(\[entry\]\) => \{/);
  assert.match(source, /const clamped = clampSplitPosition\(current, width\);/);
});
