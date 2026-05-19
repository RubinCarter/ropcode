import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.resolve(currentDir, './Settings.tsx');

async function readSource(filePath: string) {
  return fs.readFile(filePath, 'utf8');
}

test('Settings exposes session title API configuration', async () => {
  const source = await readSource(settingsPath);

  assert.match(source, /session_title_api_url/);
  assert.match(source, /session_title_api_key/);
  assert.match(source, /session_title_api_format/);
  assert.match(source, /session_title_model/);
});

test('session title settings do not fall back to chat default models', async () => {
  const source = await readSource(settingsPath);
  const sessionTitleBlock = source.slice(
    source.indexOf('Session Title Generation'),
    source.indexOf('{/* Tab Persistence Toggle */}')
  );

  assert.ok(sessionTitleBlock.length > 0, 'expected a session title settings block');
  assert.doesNotMatch(sessionTitleBlock, /default_model_/);
  assert.doesNotMatch(sessionTitleBlock, /setModelConfigDefault/);
  assert.doesNotMatch(sessionTitleBlock, /ANTHROPIC_MODEL/);
});
