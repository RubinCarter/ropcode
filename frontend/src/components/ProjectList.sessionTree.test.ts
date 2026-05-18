import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectListPath = path.resolve(currentDir, './ProjectList.tsx');
const rpcClientPath = path.resolve(currentDir, '../lib/rpc-client.ts');

async function readSource(filePath: string) {
  return fs.readFile(filePath, 'utf8');
}

test('ProjectList lazily loads mixed space sessions and opens historical chat tabs', async () => {
  const source = await readSource(projectListPath);

  assert.match(source, /api\.listSpaceSessions\(spacePath,\s*10\)/);
  assert.match(source, /api\.listSpaceSessions\(spacePath,\s*0\)/);
  assert.match(source, /openSessionTab/);
  assert.match(source, /session\.provider/);
  assert.match(source, /session\.last_activity/);
  assert.match(source, /More/);
});

test('rpc client exposes ListSpaceSessions result types and wrapper', async () => {
  const source = await readSource(rpcClientPath);

  assert.match(source, /interface ProviderSessionSummary/);
  assert.match(source, /interface SpaceSessionsResult/);
  assert.match(source, /function ListSpaceSessions\(projectPath: string, limit: number\)/);
  assert.match(source, /wsClient\.call\('ListSpaceSessions', projectPath, limit\)/);
});
