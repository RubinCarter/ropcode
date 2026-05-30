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
  assert.match(source, /const Settings = lazy\(\(\) => import\('@\/components\/Settings'\)/);
});

test('TabContent lazy-loads Agents instead of bundling it into tab shell', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.doesNotMatch(source, /import \{ Agents \} from '@\/components\/Agents';/);
  assert.match(source, /const Agents = lazy\(\(\) => import\('@\/components\/Agents'\)/);
});
