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

test('SystemContainer does not wrap static system pages in Suspense', async () => {
  const source = await fs.readFile(systemContainerPath, 'utf8');

  assert.doesNotMatch(source, /import React, \{ Suspense \}/);
  assert.doesNotMatch(source, /SettingsLoadingShell/);
  assert.doesNotMatch(source, /<Suspense/);
});
