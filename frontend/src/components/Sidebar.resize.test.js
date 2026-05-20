import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('Sidebar exposes a draggable resize handle and persists width', async () => {
  const source = await readFile(path.join(currentDir, 'Sidebar.tsx'), 'utf8');

  assert.match(source, /sidebar_width_px/);
  assert.match(source, /SIDEBAR_RAIL_WIDTH\s*=\s*64/);
  assert.match(source, /SIDEBAR_MIN_WIDTH\s*=\s*304/);
  assert.match(source, /col-resize/);
  assert.match(source, /onMouseDown=\{startSidebarResize\}/);
  assert.match(source, /width:\s*isCollapsed \? SIDEBAR_RAIL_WIDTH : sidebarWidth/);
  assert.match(source, /sidebarWidth - SIDEBAR_RAIL_WIDTH/);
});
