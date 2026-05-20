import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const componentsDir = path.resolve(currentDir, '..');

test('desktop sidebar uses a compact companion rail and a single switched panel', async () => {
  const sidebarSource = await readFile(path.join(componentsDir, 'Sidebar.tsx'), 'utf8');

  assert.match(sidebarSource, /SidebarRail/);
  assert.match(sidebarSource, /SessionPanel/);
  assert.match(sidebarSource, /panelMode/);
  assert.match(sidebarSource, /showInlineSessions=\{false\}/);
  assert.doesNotMatch(sidebarSource, /switchToSystem\('spaces'\)/);
  assert.doesNotMatch(sidebarSource, /switchToSystem\('sessions'\)/);
});

test('sidebar rail keeps top-level navigation icon-only', async () => {
  const railSource = await readFile(path.join(currentDir, 'SidebarRail.tsx'), 'utf8');

  assert.match(railSource, /aria-label/);
  assert.match(railSource, /TooltipSimple/);
  assert.doesNotMatch(railSource, />\s*Projects\s*</);
  assert.doesNotMatch(railSource, />\s*Sessions\s*</);
  assert.doesNotMatch(railSource, /switchToSystem\('spaces'\)/);
  assert.doesNotMatch(railSource, /switchToSystem\('sessions'\)/);
});
