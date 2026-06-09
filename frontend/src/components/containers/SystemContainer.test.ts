import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const systemContainerPath = path.resolve(currentDir, './SystemContainer.tsx');

test('SystemContainer statically imports system pages to avoid first-open lazy spinners', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.match(source, /import \{ Agents \} from '@\/components\/Agents';/);
  assert.match(source, /import \{ Settings \} from '@\/components\/Settings';/);
  assert.match(source, /import \{ UsageDashboard \} from '@\/components\/UsageDashboard';/);
  assert.doesNotMatch(source, /lazy\(loadAgents\)/);
  assert.doesNotMatch(source, /lazy\(loadSettings\)/);
  assert.doesNotMatch(source, /lazy\(loadUsageDashboard\)/);
});

test('SystemContainer keeps a Suspense boundary for nested lazy settings panes', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.match(source, /import \{ SettingsLoadingShell \} from '@\/components\/SettingsLoadingShell';/);
  assert.match(source, /activeTab\?\.type === 'settings'/);
  assert.match(source, /<SettingsLoadingShell \/>/);
});
