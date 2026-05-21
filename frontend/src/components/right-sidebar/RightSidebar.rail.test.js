import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('right sidebar keeps a compact icon rail when the panel is collapsed', async () => {
  const source = await readFile(path.join(currentDir, 'index.tsx'), 'utf8');

  assert.match(source, /RIGHT_SIDEBAR_RAIL_WIDTH/);
  assert.match(source, /TooltipSimple/);
  assert.match(source, /aria-label/);
  assert.doesNotMatch(source, /if\s*\(!isOpen\)\s*\{\s*return null;\s*\}/);
});

test('right sidebar top-level navigation is icon-only in the rail', async () => {
  const source = await readFile(path.join(currentDir, 'index.tsx'), 'utf8');

  assert.match(source, /RightRailButton/);
  assert.match(source, /activeRightTab === tab/);
  assert.doesNotMatch(source, /Collapse right sidebar/);
  assert.doesNotMatch(source, /Expand right sidebar/);
  assert.doesNotMatch(source, />\s*Console\s*</);
  assert.doesNotMatch(source, />\s*Files\s*</);
  assert.doesNotMatch(source, />\s*Tasks\s*</);
});
