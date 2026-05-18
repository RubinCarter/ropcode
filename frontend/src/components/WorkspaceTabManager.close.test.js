import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test('workspace chat tabs expose close controls', async () => {
  const source = await readFile(path.join(currentDir, 'containers', 'WorkspaceTabManager.tsx'), 'utf8');

  assert.doesNotMatch(source, /tab\.type !== 'chat'/);
  assert.doesNotMatch(source, /Don't close chat tabs/);
  assert.match(source, /onClose\(tab\.id\)/);
  assert.match(source, /removeTab\(activeTabId\)/);
});

test('workspace tabs expose bulk close context actions', async () => {
  const managerSource = await readFile(path.join(currentDir, 'containers', 'WorkspaceTabManager.tsx'), 'utf8');
  const contextSource = await readFile(path.join(currentDir, '..', 'contexts', 'WorkspaceTabContext.tsx'), 'utf8');

  assert.match(managerSource, /DropdownMenu/);
  assert.match(managerSource, /Close other tabs/);
  assert.match(managerSource, /Close tabs to the right/);
  assert.match(managerSource, /closeOtherTabs\(id\)/);
  assert.match(managerSource, /closeTabsToRight\(id,\s*sortedTabs\.map\(\(item\) => item\.id\)\)/);
  assert.match(contextSource, /closeOtherTabs/);
  assert.match(contextSource, /closeTabsToRight/);
  assert.match(contextSource, /findEquivalentTab/);
});

test('workspace chat tabs do not expose session liveness indicators', async () => {
  const managerSource = await readFile(path.join(currentDir, 'containers', 'WorkspaceTabManager.tsx'), 'utf8');
  const contextSource = await readFile(path.join(currentDir, '..', 'contexts', 'WorkspaceTabContext.tsx'), 'utf8');

  assert.match(contextSource, /'closed'/);
  assert.match(managerSource, /if \(tab\.type === 'chat'\) \{/);
  assert.doesNotMatch(managerSource, /case 'idle'/);
  assert.doesNotMatch(managerSource, /case 'closed'/);
  assert.doesNotMatch(managerSource, /Session idle/);
  assert.doesNotMatch(managerSource, /Session closed/);
});
