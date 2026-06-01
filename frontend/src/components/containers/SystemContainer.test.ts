import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const systemContainerPath = path.resolve(currentDir, './SystemContainer.tsx');

test('SystemContainer lazy-loads Settings to keep the system shell light', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.doesNotMatch(source, /import \{ Settings \} from '@\/components\/Settings';/);
  assert.match(source, /const loadSettings = \(\) => import\('@\/components\/Settings'\)/);
  assert.match(source, /const Settings = lazy\(loadSettings\);/);
});

test('SystemContainer lazy-loads Agents and UsageDashboard to keep the system shell light', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.doesNotMatch(source, /import \{ Agents \} from '@\/components\/Agents';/);
  assert.doesNotMatch(source, /import \{ UsageDashboard \} from '@\/components\/UsageDashboard';/);
  assert.match(source, /const Agents = lazy\(\(\) => import\('@\/components\/Agents'\)/);
  assert.match(source, /const UsageDashboard = lazy\(\(\) => import\('@\/components\/UsageDashboard'\)/);
});

test('SystemContainer shows the Settings shell while the Settings chunk loads', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.match(source, /import \{ SettingsLoadingShell \} from '@\/components\/SettingsLoadingShell';/);
  assert.match(source, /activeTab\?\.type === 'settings'/);
  assert.match(source, /<SettingsLoadingShell \/>/);
});
