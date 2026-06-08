import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const tabContentPath = path.resolve(currentDir, './TabContent.tsx');

test('TabContent lazy-loads Settings instead of bundling it into tab shell', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.doesNotMatch(source, /import \{ Settings \} from '@\/components\/Settings';/);
  assert.match(source, /const loadSettings = \(\) => \{/);
  assert.match(source, /import\('@\/components\/Settings'\)/);
  assert.match(source, /\[settings\] loading Settings chunk/);
  assert.match(source, /\[settings\] Settings chunk loaded/);
  assert.match(source, /const Settings = lazy\(loadSettings\);/);
});

test('TabContent lazy-loads Agents instead of bundling it into tab shell', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.doesNotMatch(source, /import \{ Agents \} from '@\/components\/Agents';/);
  assert.match(source, /const Agents = lazy\(\(\) => import\('@\/components\/Agents'\)/);
});

test('TabContent shows the Settings shell while the Settings chunk loads', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.match(source, /import \{ SettingsLoadingShell \} from '@\/components\/SettingsLoadingShell';/);
  assert.match(source, /tab\.type === 'settings'/);
  assert.match(source, /<SettingsLoadingShell \/>/);
});
