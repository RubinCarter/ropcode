import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const tabContentPath = path.resolve(currentDir, './TabContent.tsx');

test('TabContent statically imports system pages to avoid first-open lazy spinners', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.match(source, /import \{ Agents \} from '@\/components\/Agents';/);
  assert.match(source, /import \{ Settings \} from '@\/components\/Settings';/);
  assert.match(source, /import \{ UsageDashboard \} from '@\/components\/UsageDashboard';/);
  assert.doesNotMatch(source, /lazy\(loadAgents\)/);
  assert.doesNotMatch(source, /lazy\(loadSettings\)/);
  assert.doesNotMatch(source, /lazy\(loadUsageDashboard\)/);
});

test('TabContent keeps heavy workspace views lazy', async () => {
  const source = await fs.readFile(tabContentPath, 'utf8');

  assert.match(source, /const AiCodeSession = lazy\(loadAiCodeSession\);/);
  assert.match(source, /const FileViewer = lazy\(loadFileViewer\);/);
  assert.match(source, /const DiffViewer = lazy\(loadDiffViewer\);/);
  assert.match(source, /const WebViewWidget = lazy\(loadWebViewWidget\);/);
});
